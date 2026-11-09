package com.resound.frequencies;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.graphics.Insets;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/** Offline Android host. Only packaged, allowlisted assets can reach the bridge. */
public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/assets/index.html";
    private static final int IMPORT_SESSION = 1001;
    private static final int EXPORT_SESSION = 1002;
    private static final int MAX_SESSION_BYTES = 2_000_000;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Set<String> allowedAssets = new HashSet<>();
    private WebView webView;
    private AudioManager audioManager;
    private AudioFocusRequest focusRequest;
    private volatile boolean resumed;
    private volatile boolean focused;
    private boolean receiverRegistered;
    private boolean filePickerOpen;

    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                stopAudio("Auriculares desconectados");
            }
        }
    };

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            .setAcceptsDelayedFocusGain(false)
            .setWillPauseWhenDucked(true)
            .setOnAudioFocusChangeListener(change -> {
                if (change != AudioManager.AUDIOFOCUS_GAIN) stopAudio("Audio interrumpido");
            }, ui).build();

        final FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(16, 20, 25));
        getWindow().setStatusBarColor(Color.rgb(16, 20, 25));
        getWindow().setNavigationBarColor(Color.rgb(16, 20, 25));
        if (Build.VERSION.SDK_INT >= 29) getWindow().setNavigationBarContrastEnforced(false);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, windowInsets) -> {
                Insets insets = windowInsets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(insets.left, insets.top, insets.right, insets.bottom);
                return new WindowInsets.Builder(windowInsets)
                    .setInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
                        | WindowInsets.Type.ime(), Insets.NONE).build();
            });
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
                return insets.consumeSystemWindowInsets();
            });
        }

        readAssetAllowlist();
        WebView.setWebContentsDebuggingEnabled(false);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(16, 20, 25));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSafeBrowsingEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        webView.addJavascriptInterface(new NativeBridge(), "REsoundAndroid");
        webView.setWebViewClient(new OfflineClient());
        root.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        root.requestApplyInsets();
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) controller.setSystemBarsAppearance(0,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        }
        webView.loadUrl(START_URL);
    }

    private void readAssetAllowlist() {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                getAssets().open("web-assets.txt"), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (!line.isEmpty() && !line.contains("..") && !line.startsWith("/")) allowedAssets.add(line);
            }
        } catch (Exception ignored) { /* Missing allowlist fails closed. */ }
    }

    private String localAsset(Uri uri) {
        if (!"https".equals(uri.getScheme()) || !HOST.equals(uri.getHost())
                || (uri.getPort() != -1 && uri.getPort() != 443) || uri.getUserInfo() != null) return null;
        String encoded = uri.getEncodedPath();
        if (encoded == null || encoded.indexOf('%') >= 0 || encoded.indexOf('\\') >= 0
                || !encoded.startsWith("/assets/")) return null;
        String path = encoded.substring("/assets/".length());
        if (path.contains("..") || path.startsWith("/") || !allowedAssets.contains(path)) return null;
        return path;
    }

    private static String mime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".mjs") || path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
        if (path.endsWith(".webp")) return "image/webp";
        if (path.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked",
            Collections.singletonMap("Cache-Control", "no-store"),
            new ByteArrayInputStream(new byte[0]));
    }

    private final class OfflineClient extends WebViewClient {
        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            String asset = localAsset(request.getUrl());
            if (asset == null || !"GET".equals(request.getMethod())) return blocked();
            try {
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-store");
                headers.put("X-Content-Type-Options", "nosniff");
                headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; "
                    + "style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; "
                    + "media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'");
                return new WebResourceResponse(mime(asset), "UTF-8", 200, "OK", headers,
                    getAssets().open("web/" + asset));
            } catch (Exception ignored) { return blocked(); }
        }

        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return localAsset(request.getUrl()) == null;
        }

        @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return localAsset(Uri.parse(url)) == null;
        }
    }

    public final class NativeBridge {
        @JavascriptInterface public boolean requestAudioFocus() {
            return takeAudioFocus();
        }

        @JavascriptInterface public void abandonAudioFocus() {
            releaseAudioFocus();
        }

        @JavascriptInterface public boolean startBackgroundAudio(
                String spectrumJson, double volume, int durationSeconds, String label) {
            try {
                Intent intent = new Intent(MainActivity.this, PlaybackService.class);
                intent.setAction(PlaybackService.ACTION_PLAY);
                intent.putExtra(PlaybackService.EXTRA_SPECTRUM, spectrumJson);
                intent.putExtra(PlaybackService.EXTRA_VOLUME, volume);
                intent.putExtra(PlaybackService.EXTRA_DURATION, durationSeconds);
                intent.putExtra(PlaybackService.EXTRA_LABEL, label);
                if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent);
                else startService(intent);
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }

        @JavascriptInterface public void pauseBackgroundAudio() {
            sendPlaybackAction(PlaybackService.ACTION_PAUSE);
        }

        @JavascriptInterface public void resumeBackgroundAudio() {
            sendPlaybackAction(PlaybackService.ACTION_RESUME);
        }

        @JavascriptInterface public void stopBackgroundAudio() {
            sendPlaybackAction(PlaybackService.ACTION_STOP);
        }

        @JavascriptInterface public void setBackgroundVolume(double volume) {
            try {
                Intent intent = new Intent(MainActivity.this, PlaybackService.class);
                intent.setAction(PlaybackService.ACTION_VOLUME);
                intent.putExtra(PlaybackService.EXTRA_VOLUME, volume);
                startService(intent);
            } catch (Exception ignored) {}
        }

        @JavascriptInterface public void setBackgroundDuration(int durationSeconds) {
            try {
                Intent intent = new Intent(MainActivity.this, PlaybackService.class);
                intent.setAction(PlaybackService.ACTION_DURATION);
                intent.putExtra(PlaybackService.EXTRA_DURATION, durationSeconds);
                startService(intent);
            } catch (Exception ignored) {}
        }

        @JavascriptInterface public String getPlaybackState() {
            return PlaybackService.getPlaybackStateJson();
        }

        private void sendPlaybackAction(String action) {
            try {
                Intent intent = new Intent(MainActivity.this, PlaybackService.class);
                intent.setAction(action);
                startService(intent);
            } catch (Exception ignored) {}
        }

        @JavascriptInterface public void exportSession(String name, String json) {
            if (json == null || json.length() > MAX_SESSION_BYTES) {
                exportResult(false, "La sesión supera el tamaño admitido."); return;
            }
            final byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
            if (bytes.length > MAX_SESSION_BYTES) {
                exportResult(false, "La sesión supera el tamaño admitido."); return;
            }
            try { new JSONObject(json); }
            catch (Exception ignored) { exportResult(false, "La sesión no es un JSON válido."); return; }
            final String filename = safeFilename(name);
            ui.post(() -> {
                if (filePickerOpen) { exportResult(false, "Ya hay un selector de archivos abierto."); return; }
                try (OutputStream out = new FileOutputStream(exportCache())) { out.write(bytes); }
                catch (Exception ignored) { exportResult(false, "No se pudo preparar la sesión."); return; }
                stopAudio("Selecciona dónde guardar la sesión");
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                intent.putExtra(Intent.EXTRA_TITLE, filename);
                try { filePickerOpen = true; startActivityForResult(intent, EXPORT_SESSION); }
                catch (Exception ignored) { filePickerOpen = false; exportResult(false, "No se pudo abrir el selector de archivos."); }
            });
        }

        @JavascriptInterface public void importSession() {
            ui.post(() -> {
                if (filePickerOpen) { importError("Ya hay un selector de archivos abierto."); return; }
                stopAudio("Selecciona una sesión JSON");
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES,
                    new String[] { "application/json", "text/plain", "application/octet-stream" });
                try { filePickerOpen = true; startActivityForResult(intent, IMPORT_SESSION); }
                catch (Exception ignored) { filePickerOpen = false; importError("No se pudo abrir el selector de archivos."); }
            });
        }
    }

    private static String safeFilename(String name) {
        String clean = name == null ? "resound-sesion.json" : name.replaceAll("[^A-Za-z0-9._-]", "-");
        if (clean.length() > 80) clean = clean.substring(0, 80);
        if (clean.isEmpty()) clean = "resound-sesion.json";
        if (!clean.endsWith(".json")) clean += ".json";
        return clean;
    }

    private File exportCache() { return new File(getCacheDir(), "resound-session-export.json"); }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != IMPORT_SESSION && requestCode != EXPORT_SESSION) return;
        filePickerOpen = false;
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            if (requestCode == IMPORT_SESSION) importError("Importación cancelada.");
            else { exportCache().delete(); exportResult(false, "Exportación cancelada."); }
            return;
        }
        Uri uri = data.getData();
        if (requestCode == EXPORT_SESSION) {
            try (InputStream in = new FileInputStream(exportCache());
                 OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
                if (out == null) throw new IllegalStateException("No output");
                out.write(readBounded(in));
                exportResult(true, null);
            } catch (Exception ignored) { exportResult(false, "No se pudo guardar el archivo."); }
            finally { exportCache().delete(); }
        } else {
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                if (in == null) throw new IllegalStateException("No input");
                byte[] bytes = readBounded(in);
                String json = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes)).toString();
                new JSONObject(json);
                dispatch("resound-native-import", "{\"json\":" + JSONObject.quote(json) + "}");
            } catch (Exception ignored) { importError("El archivo debe ser un JSON válido de hasta 2 MB."); }
        }
    }

    private static byte[] readBounded(InputStream in) throws Exception {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int read;
        while ((read = in.read(chunk)) != -1) {
            if (buffer.size() + read > MAX_SESSION_BYTES) throw new IllegalArgumentException("Too large");
            buffer.write(chunk, 0, read);
        }
        return buffer.toByteArray();
    }

    private void importError(String message) {
        dispatch("resound-native-import", "{\"error\":" + JSONObject.quote(message) + "}");
    }

    private void exportResult(boolean ok, String error) {
        dispatch("resound-native-export", "{\"ok\":" + ok
            + (error == null ? "" : ",\"error\":" + JSONObject.quote(error)) + "}");
    }

    private void dispatch(String event, String detail) {
        ui.post(() -> {
            if (webView != null) webView.evaluateJavascript("window.dispatchEvent(new CustomEvent("
                + JSONObject.quote(event) + ",{detail:" + detail + "}));", null);
        });
    }

    private synchronized boolean takeAudioFocus() {
        if (!resumed || audioManager == null) return false;
        if (focused) return true;
        focused = audioManager.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        if (focused) ui.post(() -> getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));
        return focused;
    }

    private synchronized void releaseAudioFocus() {
        if (focused && audioManager != null) audioManager.abandonAudioFocusRequest(focusRequest);
        focused = false;
        ui.post(() -> getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));
    }

    private void stopAudio(String reason) {
        releaseAudioFocus();
        ui.post(() -> {
            if (webView != null) webView.evaluateJavascript(
                "window.REsoundApp&&window.REsoundApp.stop(" + JSONObject.quote(reason) + ");", null);
        });
    }

    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        if (webView != null) webView.onResume();
        if (!receiverRegistered) {
            IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(noisyReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            else registerReceiver(noisyReceiver, filter);
            receiverRegistered = true;
        }
    }

    @Override protected void onPause() {
        resumed = false;
        // The WebView can pause with the Activity; native PlaybackService owns background audio.
        if (receiverRegistered) { unregisterReceiver(noisyReceiver); receiverRegistered = false; }
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override public void onBackPressed() {
        // Closing the UI must not stop a foreground audio experiment.
        super.onBackPressed();
    }

    @Override protected void onDestroy() {
        resumed = false;
        releaseAudioFocus();
        if (receiverRegistered) { unregisterReceiver(noisyReceiver); receiverRegistered = false; }
        if (webView != null) {
            webView.removeJavascriptInterface("REsoundAndroid");
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
