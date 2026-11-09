package com.resound.frequencies;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Native foreground audio renderer for REsound.
 * It receives the exact spectral components calculated by the web UI and renders
 * stereo PCM independently of the Activity/WebView so playback survives backgrounding.
 */
public final class PlaybackService extends Service {
    public static final String ACTION_PLAY = "com.resound.frequencies.PLAY";
    public static final String ACTION_PAUSE = "com.resound.frequencies.PAUSE";
    public static final String ACTION_RESUME = "com.resound.frequencies.RESUME";
    public static final String ACTION_STOP = "com.resound.frequencies.STOP";
    public static final String ACTION_VOLUME = "com.resound.frequencies.VOLUME";
    public static final String ACTION_DURATION = "com.resound.frequencies.DURATION";

    public static final String EXTRA_SPECTRUM = "spectrum";
    public static final String EXTRA_VOLUME = "volume";
    public static final String EXTRA_DURATION = "duration";
    public static final String EXTRA_LABEL = "label";

    private static final String CHANNEL_ID = "resound_playback";
    private static final int NOTIFICATION_ID = 3040;
    private static final int SAMPLE_RATE = 48000;
    private static final int MAX_COMPONENTS_PER_CHANNEL = 1024;

    private static volatile boolean running;
    private static volatile boolean paused;
    private static volatile long renderedFrames;
    private static volatile int durationSeconds;
    private static volatile String currentLabel = "REsound";
    private static volatile double currentVolume = 0.08;

    private final Handler main = new Handler(Looper.getMainLooper());
    private AudioManager audioManager;
    private AudioFocusRequest focusRequest;
    private AudioTrack audioTrack;
    private Thread renderThread;
    private volatile boolean renderActive;
    private volatile boolean pausedByFocus;
    private PowerManager.WakeLock wakeLock;
    private boolean noisyRegistered;

    private Component[] left = new Component[0];
    private Component[] right = new Component[0];

    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction()) && running) {
                pausedByFocus = false;
                pausePlayback();
            }
        }
    };

    @Override public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build();
        focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(attributes)
            .setAcceptsDelayedFocusGain(false)
            .setWillPauseWhenDucked(true)
            .setOnAudioFocusChangeListener(change -> {
                if (change == AudioManager.AUDIOFOCUS_GAIN) {
                    if (pausedByFocus && running) {
                        pausedByFocus = false;
                        resumePlayback();
                    }
                } else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
                        || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
                    if (running && !paused) {
                        pausedByFocus = true;
                        pausePlayback();
                    }
                } else if (change == AudioManager.AUDIOFOCUS_LOSS) {
                    pausedByFocus = false;
                    stopPlayback();
                }
            }, main)
            .build();

        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        if (power != null) {
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "REsound:Playback");
            wakeLock.setReferenceCounted(false);
        }

        IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(noisyReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(noisyReceiver, filter);
        }
        noisyRegistered = true;
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_PLAY.equals(action)) {
            currentLabel = trimLabel(intent.getStringExtra(EXTRA_LABEL));
            currentVolume = clamp(intent.getDoubleExtra(EXTRA_VOLUME, currentVolume), 0.0, 1.0);
            durationSeconds = Math.max(0, intent.getIntExtra(EXTRA_DURATION, 0));

            // Promote before asking for audio focus. Android 15 only grants focus
            // to a top app or a foreground service.
            promoteForeground(false, "Preparando audio…");

            try {
                parseSpectrum(intent.getStringExtra(EXTRA_SPECTRUM));
                if (!requestFocus()) throw new IllegalStateException("No se pudo obtener foco de audio");
                startRenderer();
            } catch (Exception error) {
                stopPlayback();
            }
        } else if (ACTION_PAUSE.equals(action)) {
            pausePlayback();
        } else if (ACTION_RESUME.equals(action)) {
            resumePlayback();
        } else if (ACTION_STOP.equals(action)) {
            stopPlayback();
        } else if (ACTION_VOLUME.equals(action)) {
            currentVolume = clamp(intent.getDoubleExtra(EXTRA_VOLUME, currentVolume), 0.0, 1.0);
            if (running) updateNotification();
        } else if (ACTION_DURATION.equals(action)) {
            durationSeconds = Math.max(0, intent.getIntExtra(EXTRA_DURATION, durationSeconds));
            if (running) updateNotification();
        }
        return START_NOT_STICKY;
    }

    private synchronized void startRenderer() {
        stopRendererOnly();

        int minimum = AudioTrack.getMinBufferSize(
            SAMPLE_RATE, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT);
        int bufferBytes = Math.max(minimum, 4096 * 4);
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build();
        AudioFormat format = new AudioFormat.Builder()
            .setSampleRate(SAMPLE_RATE)
            .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .build();

        audioTrack = new AudioTrack(
            attributes, format, bufferBytes, AudioTrack.MODE_STREAM, AudioManager.AUDIO_SESSION_ID_GENERATE);
        if (audioTrack.getState() != AudioTrack.STATE_INITIALIZED) {
            audioTrack.release();
            audioTrack = null;
            throw new IllegalStateException("AudioTrack no pudo inicializarse");
        }

        running = true;
        paused = false;
        pausedByFocus = false;
        renderedFrames = 0;
        renderActive = true;
        if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire();
        promoteForeground(false, currentLabel);
        audioTrack.play();

        final AudioTrack localTrack = audioTrack;
        final Component[] localLeft = cloneComponents(left);
        final Component[] localRight = cloneComponents(right);
        renderThread = new Thread(() -> renderLoop(localTrack, localLeft, localRight), "REsoundAudio");
        renderThread.setPriority(Thread.MAX_PRIORITY);
        renderThread.start();
    }

    private void renderLoop(AudioTrack track, Component[] leftOsc, Component[] rightOsc) {
        final int framesPerBlock = 512;
        final short[] pcm = new short[framesPerBlock * 2];
        final long fadeFrames = SAMPLE_RATE / 20; // 50 ms
        int blocks = 0;

        while (renderActive && track == audioTrack && running) {
            if (paused) {
                SystemClock.sleep(20);
                continue;
            }

            int frames = framesPerBlock;
            if (durationSeconds > 0) {
                long maxFrames = (long) durationSeconds * SAMPLE_RATE;
                long remaining = maxFrames - renderedFrames;
                if (remaining <= 0) {
                    main.post(this::stopPlayback);
                    break;
                }
                frames = (int) Math.min(frames, remaining);
            }

            double volume = currentVolume;
            for (int frame = 0; frame < frames; frame++) {
                double l = sample(leftOsc);
                double r = sample(rightOsc);
                double fade = Math.min(1.0, (renderedFrames + frame + 1.0) / fadeFrames);
                double gain = volume * fade;
                pcm[frame * 2] = toPcm(l * gain);
                pcm[frame * 2 + 1] = toPcm(r * gain);
                advance(leftOsc);
                advance(rightOsc);
            }

            int shorts = track.write(pcm, 0, frames * 2, AudioTrack.WRITE_BLOCKING);
            if (shorts < 0) {
                main.post(this::stopPlayback);
                break;
            }
            renderedFrames += Math.max(0, shorts / 2);

            if ((++blocks & 31) == 0) {
                normalize(leftOsc);
                normalize(rightOsc);
            }
        }
    }

    private static double sample(Component[] components) {
        double value = 0.0;
        for (Component c : components) value += c.cosCoefficient * c.phaseCos + c.sinCoefficient * c.phaseSin;
        return value;
    }

    private static void advance(Component[] components) {
        for (Component c : components) {
            double nextCos = c.phaseCos * c.stepCos - c.phaseSin * c.stepSin;
            double nextSin = c.phaseSin * c.stepCos + c.phaseCos * c.stepSin;
            c.phaseCos = nextCos;
            c.phaseSin = nextSin;
        }
    }

    private static void normalize(Component[] components) {
        for (Component c : components) {
            double norm = Math.hypot(c.phaseCos, c.phaseSin);
            if (norm > 0.0) {
                c.phaseCos /= norm;
                c.phaseSin /= norm;
            }
        }
    }

    private static short toPcm(double value) {
        value = clamp(value, -0.98, 0.98);
        return (short) Math.round(value * 32767.0);
    }

    private synchronized void pausePlayback() {
        if (!running || paused) return;
        paused = true;
        AudioTrack track = audioTrack;
        if (track != null) {
            try { track.pause(); } catch (Exception ignored) {}
        }
        updateNotification();
    }

    private synchronized void resumePlayback() {
        if (!running || !paused) return;
        if (!requestFocus()) return;
        paused = false;
        AudioTrack track = audioTrack;
        if (track != null) {
            try { track.play(); } catch (Exception ignored) {}
        }
        updateNotification();
    }

    private synchronized void stopPlayback() {
        running = false;
        paused = false;
        pausedByFocus = false;
        renderActive = false;
        stopRendererOnly();
        if (audioManager != null && focusRequest != null) {
            try { audioManager.abandonAudioFocusRequest(focusRequest); } catch (Exception ignored) {}
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            try { wakeLock.release(); } catch (Exception ignored) {}
        }
        stopForeground(true);
        stopSelf();
    }

    private synchronized void stopRendererOnly() {
        renderActive = false;
        AudioTrack old = audioTrack;
        audioTrack = null;
        if (old != null) {
            try { old.pause(); } catch (Exception ignored) {}
            try { old.flush(); } catch (Exception ignored) {}
            try { old.stop(); } catch (Exception ignored) {}
            try { old.release(); } catch (Exception ignored) {}
        }
    }

    private boolean requestFocus() {
        return audioManager != null && focusRequest != null
            && audioManager.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
    }

    private void parseSpectrum(String json) throws Exception {
        if (json == null) throw new IllegalArgumentException("Falta el espectro");
        JSONObject root = new JSONObject(json);
        left = parseChannel(root.optJSONArray("left"));
        right = parseChannel(root.optJSONArray("right"));
        if (left.length == 0 && right.length == 0) throw new IllegalArgumentException("Salida silenciosa");
    }

    private static Component[] parseChannel(JSONArray array) throws Exception {
        if (array == null) return new Component[0];
        if (array.length() > MAX_COMPONENTS_PER_CHANNEL) {
            throw new IllegalArgumentException("Demasiadas componentes de audio");
        }
        List<Component> result = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) {
            JSONObject item = array.getJSONObject(i);
            double frequency = item.getDouble("frequency");
            double cos = item.getDouble("cos");
            double sin = item.getDouble("sin");
            if (!Double.isFinite(frequency) || !Double.isFinite(cos) || !Double.isFinite(sin)
                    || frequency <= 0.0 || frequency >= SAMPLE_RATE / 2.0) {
                throw new IllegalArgumentException("Componente fuera del rango reproducible");
            }
            if (Math.hypot(cos, sin) <= 1e-15) continue;
            result.add(new Component(frequency, cos, sin));
        }
        return result.toArray(new Component[0]);
    }

    private static Component[] cloneComponents(Component[] source) {
        Component[] copy = new Component[source.length];
        for (int i = 0; i < source.length; i++) copy[i] = source[i].copy();
        return copy;
    }

    private void promoteForeground(boolean isPaused, String text) {
        Notification notification = buildNotification(isPaused, text);
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void updateNotification() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null && running) manager.notify(NOTIFICATION_ID, buildNotification(paused, currentLabel));
    }

    private Notification buildNotification(boolean isPaused, String text) {
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(
            this, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String toggleAction = isPaused ? ACTION_RESUME : ACTION_PAUSE;
        Intent toggle = new Intent(this, PlaybackService.class).setAction(toggleAction);
        PendingIntent toggleIntent = PendingIntent.getService(
            this, 2, toggle, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent stop = new Intent(this, PlaybackService.class).setAction(ACTION_STOP);
        PendingIntent stopIntent = PendingIntent.getService(
            this, 3, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder builder = new Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(isPaused ? "REsound · en pausa" : "REsound · reproduciendo")
            .setContentText(text == null || text.isEmpty() ? "Audio binaural en segundo plano" : text)
            .setContentIntent(content)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .addAction(new Notification.Action.Builder(
                isPaused ? android.R.drawable.ic_media_play : android.R.drawable.ic_media_pause,
                isPaused ? "Reanudar" : "Pausar", toggleIntent).build())
            .addAction(new Notification.Action.Builder(
                android.R.drawable.ic_menu_close_clear_cancel, "Detener", stopIntent).build());
        return builder.build();
    }

    private void createNotificationChannel() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "Reproducción REsound", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Mantiene el experimento de audio activo en segundo plano");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    public static String getPlaybackStateJson() {
        JSONObject state = new JSONObject();
        try {
            state.put("running", running);
            state.put("paused", paused);
            state.put("elapsed", renderedFrames / (double) SAMPLE_RATE);
            state.put("duration", durationSeconds);
            state.put("volume", currentVolume);
            state.put("label", currentLabel);
        } catch (Exception ignored) {}
        return state.toString();
    }

    private static String trimLabel(String value) {
        if (value == null || value.trim().isEmpty()) return "Audio binaural en segundo plano";
        value = value.trim();
        return value.length() > 96 ? value.substring(0, 96) : value;
    }

    private static double clamp(double value, double minimum, double maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    @Override public void onTaskRemoved(Intent rootIntent) {
        // Intentionally keep the foreground playback service alive when the task UI is swiped away.
        super.onTaskRemoved(rootIntent);
    }

    @Override public void onDestroy() {
        running = false;
        paused = false;
        stopRendererOnly();
        if (audioManager != null && focusRequest != null) {
            try { audioManager.abandonAudioFocusRequest(focusRequest); } catch (Exception ignored) {}
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            try { wakeLock.release(); } catch (Exception ignored) {}
        }
        if (noisyRegistered) {
            try { unregisterReceiver(noisyReceiver); } catch (Exception ignored) {}
            noisyRegistered = false;
        }
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    private static final class Component {
        final double cosCoefficient;
        final double sinCoefficient;
        final double stepCos;
        final double stepSin;
        double phaseCos = 1.0;
        double phaseSin = 0.0;

        Component(double frequency, double cosCoefficient, double sinCoefficient) {
            this(cosCoefficient, sinCoefficient,
                Math.cos(2.0 * Math.PI * frequency / SAMPLE_RATE),
                Math.sin(2.0 * Math.PI * frequency / SAMPLE_RATE));
        }

        private Component(double cosCoefficient, double sinCoefficient, double stepCos, double stepSin) {
            this.cosCoefficient = cosCoefficient;
            this.sinCoefficient = sinCoefficient;
            this.stepCos = stepCos;
            this.stepSin = stepSin;
        }

        Component copy() {
            return new Component(cosCoefficient, sinCoefficient, stepCos, stepSin);
        }
    }
}
