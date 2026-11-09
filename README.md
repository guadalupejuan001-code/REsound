# REsound · Binaural

Una herramienta de la línea de productos **REsound** para crear pruebas de audio binaural, experimentar con tonos y observar sus combinaciones. La versión 0.2.0 incorpora una APK Android autónoma y una interfaz sencilla de **tono base + diferencia entre oídos**. Funciona sin conexión y conserva las pruebas en el dispositivo.

## Android

La APK se llama `REsound-Binaural-0.2.0.apk`, con paquete `com.resound.frequencies`. Requiere Android 8.0 o posterior y un Android System WebView actualizado. Todo el código de la interfaz está incorporado en la APK; no necesita iniciar sesión ni abrir una web.

1. Conecta auriculares estéreo.
2. Escribe el **tono base**, que se envía al oído izquierdo, y la **diferencia**, que se añade para obtener el tono derecho. Por ejemplo, 200 y 10 producen L 200 Hz / R 210 Hz.
3. Elige volumen y duración; pulsa **Reproducir**. **Detener** permanece accesible en la barra inferior.
4. Abre **Mis pruebas** para guardar una configuración y tus observaciones, o exportarlas a JSON.

**Tonos libres** permite ajustar cada tono, el canal, la fase y el nivel. Conserva su configuración al pasar al modo binaural y volver. La herramienta es un generador propio para experimentos binaurales; no incluye grabaciones ni programas de Hemi-Sync.

La pantalla permanece encendida durante la prueba. Salir de la aplicación, bloquear el teléfono, perder el foco de audio o desconectar auriculares detiene la reproducción. No hay reproducción en segundo plano en esta versión.

Consulta [android/README.md](android/README.md) para compilar y firmar la APK. Las claves de firma se conservan fuera del repositorio.

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
