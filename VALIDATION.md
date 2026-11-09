# Verificación de REsound Binaural 0.2.0

Fecha: 9 de noviembre de 2026.

## APK Android 0.2.0

Se compiló y firmó `REsound-Binaural-0.2.0.apk` sin descargar dependencias. El paquete es `com.resound.frequencies`, versión 0.2.0, código 2, SDK mínimo 26 y destino 35.

- Tamaño: 46 194 bytes.
- SHA-256: `5aee33a5b89f5648efa43d4761c38c495b8ff33e10b0ef19b6f50ef19b7af58c`.
- `apksigner verify --verbose`: firma v2 y v3 válidas; un firmante.
- `zipalign -c 4`: aprobado.
- `aapt dump permissions`: no declara permisos.
- Los siete archivos de `dist/` están incorporados; `app.mjs` dentro del APK coincide byte a byte con el archivo fuente.
- El APK incluye `classes.dex`, recursos y la lista de recursos permitidos. No incluye las páginas de QA.

La APK final se instaló/actualizó correctamente en un emulador Android 15 / API 35, con respuesta `Success`. El sistema completó el arranque y PackageManager reconoció `com.resound.frequencies`.

La apertura visual nativa quedó limitada por el entorno: el emulador, sin aceleración KVM, mostró `System UI isn't responding` y el lanzamiento agotó su plazo. No se presenta esta instalación como una prueba aprobada de la pantalla, del audio ni del selector de archivos de Android. La revisión de insets, foco de audio y SAF fue de código; falta verificarlos en un dispositivo con funcionamiento normal.

## Interfaz binaural 0.2.0

Se comprobó la interfaz actual en Chrome: base de 200 Hz y diferencia de 7,83 Hz producen la lectura L 200 / R 207,83 y dos componentes espectrales. Se inició y detuvo la reproducción, se cambió entre el modo binaural y tonos libres, y se guardó una prueba. Una base vacía impidió guardar y mostró el error correspondiente.

La página de QA cargó la aplicación real en marcos de 360 y 320 px. Ambos pasaron sin desbordamiento horizontal: anchos útiles de 345 y 305 px respectivamente por la barra de desplazamiento del navegador; ningún control o canvas excedió el ancho. También se inspeccionó visualmente la disposición.

La revisión corrigió la validación de instantáneas binaurales incompletas, la normalización de configuraciones libres importadas y la conservación de los valores decimales al recuperar una prueba.

## Pruebas automatizadas locales

`node --test tests/*.test.mjs`: **19 pruebas aprobadas**.

13 pruebas del núcleo comprueban el enrutamiento estéreo, suma sin frecuencias espurias, productos de suma y diferencia, cancelación, DC, fases arbitrarias, múltiples tonos, desactivación, normalización, límites numéricos y Nyquist sobre la salida efectiva.

3 pruebas del motor reproducen eventos temporales con un AudioParam simulado: ausencia de pico de ganancia antes del inicio; modificación de duración durante la rampa de parada; conservación de volumen y duración modificados mientras el navegador habilita el audio. Estas tres pruebas son regresiones del código de programación, no mediciones de un dispositivo físico.

3 pruebas binaurales comprueban los canales automáticos, que la diferencia no se genere como un tercer tono, los valores decimales/cero/negativos, los límites y el reconocimiento de sesiones compatibles.

## Base del motor verificada en 0.1.0

La página `tests/qa-audio.html` se ejecutó en Chrome con `OfflineAudioContext`: dos canales, 48 000 muestras, 48 000 muestras/s. **7/7 pruebas aprobadas**. Los buffers fueron renderizados por Web Audio y comparados mediante correlación y muestras; no se conectó ese contexto a altavoces.

| Caso | Resultado observado |
| --- | --- |
| Estéreo 200/210 Hz | L200 = 1.000000; R210 = 1.000000. Cruce medido L210 ≈ 1.221e-6; R200 ≈ 8.859e-8. |
| Suma | L200 = 0.500000; L210 = 0.500000; L10 ≈ 3.033e-9; L410 ≈ 3.487e-8. Ambos canales comprobados. |
| Multiplicación | Coeficiente coseno a 10 Hz = +0.500000; a 410 Hz = −0.500000. Restos a 200/210 Hz inferiores a 5e-8. |
| Multiplicación de frecuencias iguales | DC ideal = 0.5 omitida; coeficiente coseno a 400 Hz = −0.500000; media del buffer ≈ 2.041e-9. |
| Fases 90°/180°, estéreo | 1002 comparaciones; error absoluto máximo ≈ 5.227e-5. |
| Fases 90°/180°, suma | 1002 comparaciones; error absoluto máximo ≈ 4.716e-5. |
| Fases 90°/180°, multiplicación | 1002 comparaciones; error absoluto máximo ≈ 1.045e-5. |

La tolerancia para amplitudes fue 0.0005 y para muestras fue 0.001. El resultado es compatible con la precisión finita del renderizado digital; no se afirma exactitud física infinita.

## Interacciones y disposición verificadas en 0.1.0

Se comprobó la aplicación en el navegador: inicio de reproducción con una frecuencia de muestreo efectiva de 44 100 muestras/s, selección de modos, cancelación al sumar 200 Hz y 200 Hz con 180° de fase, adición y eliminación de tonos, guardado de nombre/notas y exportación e importación del mismo archivo JSON. Tras importar, la interfaz confirmó el volumen inicial del 8% y los valores 200/210 Hz.

La página de verificación móvil cargó la aplicación real en dos iframes. Resultados:

| Viewport | Ancho útil | Ancho del contenido | Resultado |
| --- | --- | --- | --- |
| 360 px | 345 px (barra de desplazamiento de escritorio) | 345 px | PASS; ningún control ni canvas fuera del ancho. |
| 320 px | 305 px (barra de desplazamiento de escritorio) | 305 px | PASS; ningún control ni canvas fuera del ancho. |

Se inspeccionó también una captura de la interfaz de escritorio y de las dos disposiciones móviles. El código contempla el espacio seguro inferior del dispositivo.

## Alcance

La validación cubre el modelo digital, la generación Web Audio, la interfaz y el empaquetado de Android. No se midieron el DAC, los auriculares, la presión acústica, la audición ni la actividad cerebral del usuario. No se ejecutó una prueba física en su teléfono. Las cifras de Web Audio de la sección 0.1.0 proceden de aquella verificación del mismo motor; no se presentan como una medición acústica de Android.

Para repetir el QA web, sirve la raíz del repositorio y abre `tests/qa-audio.html` y `tests/qa-mobile.html`. Esas páginas de pruebas se conservan en el código y se excluyen del directorio publicado `dist/`.
