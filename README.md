# REsound · Frecuencias

Una herramienta de la línea de productos **REsound** para experimentar con tonos, canales L/R y sus combinaciones. Funciona en el navegador del teléfono o del ordenador, sin instalar paquetes ni enviar las sesiones a un servidor.

## Abrir

Aplicación: https://resound-frecuencias-x.guadalupejuan001.chatgpt.site

El despliegue de la herramienta es privado para su propietario. Este repositorio conserva su código fuente.

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
- Guardar configuraciones y observaciones en este navegador; exportar e importar sesiones JSON.

**L/R separados:** se suman los tonos asignados a cada canal y se preserva la separación estéreo.

**Sumar a ambos:** se suman todos los tonos y se envía la misma señal a L y R.

**Multiplicar L × R:** se multiplica la suma del grupo izquierdo por la suma del derecho y se envía el resultado a ambos canales. No es un producto de todos los tonos individuales.

Cada suma usa el divisor `max(1, suma de niveles)` para mantener el margen digital y conservar los niveles bajos. La mezcla no incluye compresor ni distorsión oculta.

## Qué representan las gráficas

Son señales ideales calculadas a partir de los tonos configurados, antes del volumen general. El mismo espectro calculado controla los osciladores que reproducen el sonido. No son un análisis del micrófono ni una medición de actividad cerebral.

Por ejemplo, sumar 200 y 210 Hz conserva esas dos componentes. Su diferencia de 10 Hz aparece como diferencia entre entradas, sin contarse como un tercer tono. Al multiplicarlas, las componentes de salida son 10 y 410 Hz. Cuando dos tonos iguales se suman con amplitudes iguales y 180° de desfase, la salida se cancela.

Las componentes constantes de 0 Hz (DC) se muestran por separado y no se envían al dispositivo de audio. En vistas temporales densas, se dibujan mínimos/máximos por píxel; a densidades extremas, se etiqueta y dibuja una envolvente acotada para no simular una frecuencia falsa por submuestreo visual.

## Límites explícitos

El análisis acepta frecuencias no negativas finitas representables en JavaScript. La reproducción verifica las componentes efectivas de salida contra la mitad de la frecuencia de muestreo real del navegador; una combinación fuera del rango se puede analizar, pero no se reproduce plegada a otra frecuencia. La respuesta acústica real también depende de los auriculares y del dispositivo.

El control general empieza al 8%. Reabrir, importar o cargar una sesión restaura ese nivel inicial sin empezar a sonar. Este porcentaje es una ganancia digital, no una medida de presión acústica. El inicio, los cambios y la parada usan transiciones breves. El temporizador se programa también sobre el reloj de audio. Al ocultarse la página se detiene la reproducción.

El guardado es local al navegador y al origen web. Exportar JSON permite conservar una copia y moverla a otro navegador. Las importaciones tienen un límite de 2 MB y 256 tonos para evitar bloquear el teléfono con archivos desproporcionados. No se recopilan notas ni se transmiten las sesiones.

## Estructura y pruebas

- `dist/audio-core.mjs`: álgebra de señales, fases, normalización y validación.
- `dist/audio-engine.mjs`: salida Web Audio estéreo con fase coherente, transiciones y duración.
- `dist/app.mjs`: controles, sesiones y estado de la herramienta.
- `dist/charts.mjs`: ondas y espectro.
- `dist/index.html`, `dist/styles.css`: interfaz adaptable.
- `tests/`: pruebas matemáticas y verificación de Web Audio y móvil.

```bash
npm test
```

Las pruebas matemáticas usan el ejecutor integrado de Node; no requieren dependencias. Para ejecutar las pruebas de navegador, sirve la raíz del repositorio y abre `tests/qa-audio.html` o `tests/qa-mobile.html`.

Consulta [VALIDATION.md](VALIDATION.md) para los resultados observados y el alcance de la verificación.

## Referencias técnicas

- [W3C — Web Audio API](https://www.w3.org/TR/webaudio-1.0/): coeficientes `PeriodicWave`, osciladores y canales.
- [Penn State — Superposition of Waves](https://www.acs.psu.edu/drussell/Demos/superposition/superposition.html): suma, fase y batimientos.
- [Analog Devices — IP3 and Intermodulation Guide](https://www.analog.com/en/resources/technical-articles/ip3-and-intermodulation-guide.html): productos no lineales y componentes de intermodulación.

La interfaz permite registrar observaciones personales sin atribuirles automáticamente un efecto neurológico.
