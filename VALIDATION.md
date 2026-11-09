# Verificación de REsound Frecuencias 0.1.0

Fecha: 9 de noviembre de 2026.

## Pruebas automatizadas locales

`node --test tests/*.test.mjs`: **16 pruebas aprobadas**.

13 pruebas del núcleo comprueban el enrutamiento estéreo, suma sin frecuencias espurias, productos de suma y diferencia, cancelación, DC, fases arbitrarias, múltiples tonos, desactivación, normalización, límites numéricos y Nyquist sobre la salida efectiva.

3 pruebas del motor reproducen eventos temporales con un AudioParam simulado: ausencia de pico de ganancia antes del inicio; modificación de duración durante la rampa de parada; conservación de volumen y duración modificados mientras el navegador habilita el audio. Estas tres pruebas son regresiones del código de programación, no mediciones de un dispositivo físico.

## Web Audio real del navegador

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

## Interacciones y disposición

Se comprobó la aplicación en el navegador: inicio de reproducción con una frecuencia de muestreo efectiva de 44 100 muestras/s, selección de modos, cancelación al sumar 200 Hz y 200 Hz con 180° de fase, adición y eliminación de tonos, guardado de nombre/notas y exportación e importación del mismo archivo JSON. Tras importar, la interfaz confirmó el volumen inicial del 8% y los valores 200/210 Hz.

La página de verificación móvil cargó la aplicación real en dos iframes. Resultados:

| Viewport | Ancho útil | Ancho del contenido | Resultado |
| --- | --- | --- | --- |
| 360 px | 345 px (barra de desplazamiento de escritorio) | 345 px | PASS; ningún control ni canvas fuera del ancho. |
| 320 px | 305 px (barra de desplazamiento de escritorio) | 305 px | PASS; ningún control ni canvas fuera del ancho. |

Se inspeccionó también una captura de la interfaz de escritorio y de las dos disposiciones móviles. El código contempla el espacio seguro inferior del dispositivo.

## Alcance

La validación cubre el modelo digital, la generación Web Audio y la interfaz del navegador. No se midieron el DAC, los auriculares, la presión acústica, la audición ni la actividad cerebral del usuario. No se ejecutó una prueba física en su Samsung ni se generó un APK en este trabajo.

Para repetir el QA web, sirve la raíz del repositorio y abre `tests/qa-audio.html` y `tests/qa-mobile.html`. Esas páginas de pruebas se conservan en el código y se excluyen del directorio publicado `dist/`.
