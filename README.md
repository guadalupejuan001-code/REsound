# REsound · Binaural

Una herramienta de la línea de productos **REsound** para crear pruebas de audio binaural, experimentar con tonos y observar sus combinaciones. La versión 0.3.0 renueva la interfaz, el icono y la reproducción Android: el audio se genera en un **servicio nativo de media playback**, por lo que puede continuar al salir de la interfaz o apagar la pantalla. Funciona sin conexión y conserva las pruebas en el dispositivo.

## Android

La APK se llama `REsound-0.3.0.apk`, con paquete `com.resound.frequencies`. Requiere Android 8.0 o posterior y un Android System WebView actualizado. Todo el código de la interfaz está incorporado en la APK; no necesita iniciar sesión ni abrir una web.

1. Conecta auriculares estéreo.
2. Escribe el **tono base**, que se envía al oído izquierdo, y la **diferencia**, que se añade para obtener el tono derecho. Por ejemplo, 200 y 10 producen L 200 Hz / R 210 Hz.
3. Elige volumen y duración; pulsa **Reproducir**. **Detener** permanece accesible en la barra inferior.
4. Abre **Mis pruebas** para guardar una configuración y tus observaciones, o exportarlas a JSON.

**Tonos libres** permite ajustar cada tono, el canal, la fase y el nivel. Conserva su configuración al pasar al modo binaural y volver. La herramienta es un generador propio para experimentos binaurales; no incluye grabaciones ni programas de Hemi-Sync.

En Android, la reproducción se ejecuta fuera de la Activity mediante `PlaybackService`. Salir de REsound, cambiar de aplicación, apagar la pantalla o retirar la tarea de recientes no detiene por sí solo una sesión activa. Una notificación persistente permite **Pausar / Reanudar / Detener**. Una pérdida permanente de foco de audio detiene la sesión; desconectar auriculares la pausa para evitar que el estímulo salte al altavoz. Forzar la detención de la app desde Android sí termina el servicio.

Consulta [android/README.md](android/README.md) para compilar y firmar la APK. Las claves de firma se conservan fuera del repositorio.

## REsound 0.3

- Interfaz visual renovada con tarjetas, iconos, señalización L/R y un estado explícito de segundo plano.
- Nuevo icono de launcher y nuevo icono monocromo para la notificación.
- El motor web sigue calculando el espectro exacto; en Android transmite esas componentes al renderizador PCM nativo.
- Audio estéreo PCM a 48 kHz mediante `AudioTrack`, con foco de audio, pausa/reanudación y `PARTIAL_WAKE_LOCK`.
- El servicio se declara como `foregroundServiceType="mediaPlayback"`, conforme al modelo de reproducción en segundo plano de Android moderno.
- La versión web conserva Web Audio; el cambio nativo se activa solo dentro de la APK.

## Entender los controles

**Hz** significa ciclos por segundo: 200 Hz describe una señal que repite su ciclo 200 veces por segundo. La frecuencia determina lo grave o agudo del tono; el volumen es otro control.

En el modo binaural, el oído izquierdo recibe la base y el derecho recibe `base + diferencia`:

| Base | Diferencia escrita | Izquierdo L | Derecho R | Lectura |
| --- | --- | --- | --- | --- |
| 200 Hz | 10 Hz | 200 Hz | 210 Hz | Derecho 10 Hz más agudo. |
| 200 Hz | 0 Hz | 200 Hz | 200 Hz | Mismo tono en ambos; no es silencio. |
| 200 Hz | −10 Hz | 200 Hz | 190 Hz | Derecho 10 Hz más grave; separación de 10 Hz. |

Con auriculares y dos tonos cercanos separados puede percibirse una pulsación relacionada con la diferencia. En 200/210, el generador envía dos tonos y no añade un tercer tono de 10 Hz. La distinción entre percepción binaural y componente espectral está descrita en [Orozco Perez, Dumas y Lehmann, eNeuro 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7082494/). La app no mide actividad cerebral ni determina si los hemisferios están sincronizados.

La pantalla muestra el cálculo con los valores actuales, explica qué cambia cada control y ofrece una guía desplegable cerca del inicio. Las ayudas de gráficas distinguen tiempo, amplitud, frecuencias presentes y número de frecuencias distintas; las de tonos libres explican canal, fase y nivel. El texto se adapta a diferencia cero, negativa y canales a 0 Hz. Los valores incompletos señalan que la gráfica conserva la última configuración válida.

Para comparar pruebas, mantén la base y el volumen y cambia una sola variable. **Mis pruebas** guarda los parámetros y lo que observaste; esas notas son observaciones personales, no mediciones del cerebro.

## Navegador

Para ejecutarla localmente, sirve `dist/` con un servidor HTTP. Por ejemplo:

```bash
python3 -m http.server 8000 --directory dist
```

Abre `http://localhost:8000`. La reproducción comienza únicamente cuando se pulsa **Reproducir**. Para escuchar canales independientes, utiliza auriculares y comienza con volumen bajo.

## Controles

- Añadir, desactivar y quitar tonos sinusoidales.
- Escribir frecuencias decimales y elegir L (izquierda) o R (derecha).
- Ajustar la fase en grados, el nivel de cada tono y el volumen general.
- Elegir una duración o reproducir hasta detener manualmente.
- Ver la onda de salida, el espectro ideal y la cantidad de frecuencias distintas presentes.
- Guardar configuraciones y observaciones localmente; exportar e importar sesiones JSON con el selector de archivos del dispositivo.

**L/R separados:** se suman los tonos asignados a cada canal y se preserva la separación estéreo.

**Sumar a ambos:** se suman todos los tonos y se envía la misma señal a L y R.

**Multiplicar L × R:** se multiplica la suma del grupo izquierdo por la suma del derecho y se envía el resultado a ambos canales. No es un producto de todos los tonos individuales.

Cada suma usa el divisor `max(1, suma de niveles)` para mantener el margen digital y conservar los niveles bajos. La mezcla no incluye compresor ni distorsión oculta.

## Qué representan las gráficas

Son señales ideales calculadas a partir de los tonos configurados, antes del volumen general. El mismo espectro calculado controla los osciladores que reproducen el sonido. No son un análisis del micrófono ni una medición de actividad cerebral.

Por ejemplo, sumar 200 y 210 Hz conserva esas dos componentes. Su diferencia de 10 Hz aparece como diferencia entre entradas, sin contarse como un tercer tono. Al multiplicarlas, las componentes de salida son 10 y 410 Hz. Cuando dos tonos iguales se suman con amplitudes iguales y 180° de desfase, la salida se cancela.

Las componentes constantes de 0 Hz (DC) se muestran por separado y no se envían al dispositivo de audio. En vistas temporales densas, se dibujan mínimos/máximos por píxel; a densidades extremas, se etiqueta y dibuja una envolvente acotada para no simular una frecuencia falsa por submuestreo visual.

## Límites explícitos

El análisis acepta frecuencias no negativas finitas representables en JavaScript. La diferencia binaural admite decimales y valores negativos mientras ambas frecuencias resultantes sean no negativas. La reproducción verifica las componentes efectivas de salida contra la mitad de la frecuencia de muestreo real de Web Audio; una combinación fuera del rango se puede analizar, pero no se reproduce plegada a otra frecuencia. La respuesta acústica real también depende de los auriculares y del dispositivo.

El control general empieza al 8%. Reabrir, importar o cargar una sesión restaura ese nivel inicial sin empezar a sonar. Este porcentaje es una ganancia digital, no una medida de presión acústica. El inicio, los cambios y la parada usan transiciones breves. El temporizador se programa también sobre el reloj de audio. Al ocultarse la página se detiene la reproducción.

El guardado es local a la aplicación o al origen web. Exportar JSON permite conservar una copia y moverla entre dispositivos. Desinstalar la app puede eliminar los datos locales: exporta las pruebas que quieras conservar. Las importaciones tienen un límite de 2 MB para archivos de configuración. El número de tonos utilizable depende de la capacidad del dispositivo. La APK no declara permisos de Internet, micrófono ni almacenamiento general.

## Estructura y pruebas

- `dist/audio-core.mjs`: álgebra de señales, fases, normalización y validación.
- `dist/audio-engine.mjs`: salida Web Audio estéreo con fase coherente, transiciones y duración.
- `dist/binaural.mjs`: pareja L/R automática y reconocimiento de sesiones compatibles.
- `dist/app.mjs`: controles, sesiones y estado de la herramienta.
- `dist/charts.mjs`: ondas y espectro.
- `dist/index.html`, `dist/styles.css`: interfaz adaptable.
- `tests/`: pruebas matemáticas y verificación de Web Audio y móvil.
- `android/`: contenedor Android, foco de audio, barras del sistema y selector de archivos.
- `scripts/build-android.sh`: compilación y firma sin descargar dependencias.

```bash
npm test
```

Las pruebas matemáticas usan el ejecutor integrado de Node; no requieren dependencias. Para ejecutar las pruebas de navegador, sirve la raíz del repositorio y abre `tests/qa-audio.html` o `tests/qa-mobile.html`.

Consulta [VALIDATION.md](VALIDATION.md) para los resultados observados y el alcance de la verificación.

## Referencias técnicas

- [W3C — Web Audio API](https://www.w3.org/TR/webaudio-1.0/): coeficientes `PeriodicWave`, osciladores y canales.
- [Penn State — Superposition of Waves](https://www.acs.psu.edu/drussell/Demos/superposition/superposition.html): suma, fase y batimientos.
- [Analog Devices — IP3 and Intermodulation Guide](https://www.analog.com/en/resources/technical-articles/ip3-and-intermodulation-guide.html): productos no lineales y componentes de intermodulación.
- [Android — Audio focus](https://developer.android.com/media/optimize/audio-focus): interrupciones y foco de reproducción.
- [Android — WebView window insets](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets): integración de la interfaz con las barras del sistema.

La interfaz permite registrar observaciones personales sin atribuirles automáticamente un efecto neurológico.
