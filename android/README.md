# REsound Binaural para Android

Aplicación local `com.resound.frequencies`, versión 0.2.1 (código 3), Android 8.0 o posterior. El APK incorpora los archivos de `dist/`; no necesita la web publicada ni iniciar sesión. Esta actualización añade explicaciones junto a los controles y conserva la firma de 0.2.0 para actualizar la instalación existente.

## Comportamiento nativo

- No declara permisos de Internet, micrófono o acceso general al almacenamiento.
- El WebView solo recibe los archivos incorporados en el APK, mediante una allowlist generada durante la compilación y un origen HTTPS local. No puede navegar a otros sitios ni leer archivos del dispositivo.
- El espacio ocupado por las barras de Android, recortes y teclado se aplica al contenedor nativo antes de colocar la interfaz.
- Solicita foco de audio al reproducir y lo abandona al detener. Una llamada, otro audio que le quite el foco, desconectar auriculares o salir de la aplicación detiene la prueba.
- Mientras conserva el foco de audio, mantiene la pantalla encendida. Bloquear manualmente el teléfono o salir detiene la reproducción. Esta versión no reproduce en segundo plano.
- Importar y exportar JSON utiliza el selector de archivos de Android. Cada archivo admite hasta 2 MB. No requiere permisos generales de archivos.
- La depuración remota del WebView está desactivada.

## Compilar

Se necesitan Java 17, Android API 35, Android Build Tools 35, Python 3 y ZIP. No se usa Gradle ni se descargan dependencias durante la compilación.

```bash
export RESOUND_BUILD_TOOLS=/ruta/android-sdk/build-tools/35.0.0
export RESOUND_ANDROID_JAR=/ruta/android-sdk/platforms/android-35/android.jar
export RESOUND_JAVAC=/ruta/jdk/bin/javac
scripts/build-android.sh /ruta/salida/REsound-Binaural-0.2.1.apk
```

Sin clave de firma, el script produce `android/build/aligned.apk`, que todavía no es el APK instalable final. Para firmarlo, proporciona `RESOUND_KEYSTORE`, `RESOUND_KEYSTORE_PASSWORD` y, si corresponde, `RESOUND_KEY_ALIAS` y `RESOUND_KEY_PASSWORD` mediante el entorno. El alias predeterminado es `resound`; la contraseña de clave utiliza la contraseña del almacén si no se proporciona por separado. El script pasa las contraseñas a `apksigner` por referencia al entorno, sin imprimirlas ni ponerlas en sus argumentos.

La clave de firma debe conservarse de forma privada para que futuras versiones puedan actualizar esta instalación. No debe añadirse al repositorio.

## Contrato con la interfaz

`window.REsoundAndroid` ofrece:

```text
requestAudioFocus() -> boolean
abandonAudioFocus()
exportSession(filename, json)
importSession()
```

La interfaz debe exponer `window.REsoundApp.stop(reason)` para las interrupciones nativas.

El resultado de importación se publica como `resound-native-import`, con `event.detail.json` o `event.detail.error`. La exportación publica `resound-native-export`, con `event.detail.ok` y, si falla o se cancela, `event.detail.error`.

`build-android.sh` copia los archivos actuales de `dist/` y genera su allowlist automáticamente. Las páginas de pruebas permanecen fuera del APK cuando se conservan en `tests/`.
