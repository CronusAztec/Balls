import type { BlogPost } from "./blog";

/** Spanish blog posts. Posts without a Spanish version fall back to English automatically. */
export const POSTS_ES: BlogPost[] = [
  {
    slug: "every-viralballs-mode-explained",
    locale: "es",
    title: "Todos los modos de ViralBalls explicados — y cuál consigue más visualizaciones",
    description: "Un recorrido por los 12 modos de juego con ajustes recomendados, qué hace que cada uno funcione en pantalla y cómo elegir el modo adecuado para tu próximo clip.",
    date: "2026-03-28",
    readingTime: "10 min de lectura",
    tags: ["guía", "modos de juego", "tutorial", "contenido viral", "ajustes", "consejos"],
    content: `ViralBalls incluye **12 modos de juego**, y cada uno produce un tipo de vídeo visiblemente distinto. Elegir el modo, y después ajustar un puñado de parámetros, es la palanca más importante que tienes sobre el rendimiento de un clip. Esta guía recorre cada modo, explica la mecánica que hay detrás y lista los ajustes que suelen funcionar en vídeo corto.

## 1. Clásico

El que todo el mundo imagina: una pelota rebota dentro de anillos concéntricos, cada uno con un solo hueco. Cuando se alinea con el hueco lo atraviesa, el anillo se rompe con el efecto elegido y la pelota pasa al siguiente hasta escapar.

**Por qué funciona:** pura tensión y alivio. El espectador anima en silencio a la pelota, y cada anillo roto es una pequeña recompensa que lo mantiene esperando el siguiente. Además es el formato más legible al instante, lo que importa cuando tienes un segundo para frenar un pulgar.

**Ajustes sugeridos:**

- **Paredes:** de 5 a 7. Suficientes capas para crear tensión, no tantas como para que el clip se alargue.
- **Efecto de ruptura:** «Todos» para la máxima recompensa, o Confeti para un aspecto más limpio.
- **Más rebote en cada golpe:** activado. La pelota se acelera hacia un clímax natural.
- **Paredes arcoíris:** Degradado.
- **Duración:** 15 a 20 segundos.

**Consejo:** añade un texto superior como *«¿Escapará?»*. Una pregunta en el primer fotograma aumenta de forma fiable el tiempo de visualización.

## 2. Acumulación

Un temporizador cuenta atrás. Cuando llega a cero la pelota se congela donde está y se convierte en un obstáculo permanente; luego aparece una pelota nueva y el temporizador se reinicia. Las pelotas congeladas se acumulan hasta que la última escapa o queda encerrada.

**Por qué funciona:** hay algo en juego. El espacio que se reduce resulta claustrofóbico, y el espectador se implica en si la pelota nueva podrá sortear el laberinto que dejaron las anteriores.

**Ajustes sugeridos:**

- **Tiempo de escape:** 3 a 4 segundos mantiene el ritmo.
- **Paredes:** el modo usa un solo anillo, así que céntrate en el tamaño del hueco: 0,3 a 0,4.
- **Púas:** activadas, con 6 a 8 púas para más peligro.
- **Duración:** 20 a 30 segundos para que se acumulen suficientes pelotas.

**Consejo:** el escape final entre un campo de pelotas congeladas es el plano estrella. Recorta la exportación para que el clip termine justo después.

## 3. Multiplicar

Cada vez que una pelota escapa del anillo, aparecen varias nuevas en el centro. Una se convierte en tres, tres en nueve, y en segundos la pantalla es puro caos.

**Por qué funciona:** el crecimiento exponencial hipnotiza. El momento en que la arena se inunda con docenas de pelotas escapando a la vez es el que más reacciones de «espera, ¿qué?» genera en los comentarios.

**Ajustes sugeridos:**

- **Pelotas generadas:** 3. Valores más altos llenan la pantalla antes pero pueden pesar en dispositivos antiguos.
- **Efecto de ruptura:** Confeti. Con tantos escapes, fragmentación más onda expansiva se convierte en ruido.
- **Rastro de color:** activado. Convierte el caos en estelas que parecen intencionadas.
- **Pelota arcoíris:** activada, para que cada clon tenga su propio tono.
- **Duración:** 15 a 25 segundos.

## 4. Líneas

Cada punto de rebote se registra y se conecta con la pelota mediante una línea, así que la simulación dibuja poco a poco arte de hilos sobre el lienzo.

**Por qué funciona:** el patrón se revela gradualmente y parece que llevó horas hacerlo. Estos clips funcionan bien con audiencias de arte y diseño.

**Ajustes sugeridos:**

- **Color de línea:** blanco o un solo acento brillante, o Arcoíris para todo el espectro.
- **Obstáculo central:** activado. El punto central añade una segunda superficie de rebote y una geometría más variada.
- **Velocidad de la pelota:** media a alta. Más rebotes por segundo significa arte más denso.
- **Duración:** 20 a 30 segundos, para que el patrón tenga tiempo de desarrollarse.

**Consejo:** deja la rotación de paredes activada. Las paredes giratorias convierten la geometría recta en patrones curvos, como de espirógrafo.

## 5. Pintar

La pelota deja un rastro arcoíris permanente y un contador registra cuánto del círculo se ha pintado. El objetivo es el 100%.

**Por qué funciona:** mecánica de compleción. Un porcentaje que sube da al espectador una razón concreta para quedarse hasta el final, el mismo tirón que hace tan satisfactorias las barras de progreso y los vídeos de limpieza a presión.

**Ajustes sugeridos:**

- **Tamaño de la pelota:** mayor. Más área cubierta por rebote significa un camino más rápido al 100%.
- **Gravedad:** baja. La pelota flota y cubre todo el círculo en lugar de acumularse abajo.
- **Rastro de color:** activado (es la esencia del modo).
- **Duración:** 25 a 30 segundos.

**Consejo:** el texto *«¿Llegará al 100%?»* supera sistemáticamente a los clips de Pintar sin gancho.

## 6. Objetivo

Segmentos numerados recubren la pared y deben golpearse en orden: 10, luego 9, luego 8. Si golpeas el equivocado parpadea en rojo; si aciertas se rompe con un efecto.

**Por qué funciona:** convierte la simulación en un juego. Los casi-aciertos crean momentos de «¡tan cerca!», y los espectadores empiezan a dar instrucciones a la pelota en los comentarios.

**Ajustes sugeridos:**

- **Número de objetivos:** 8 a 12.
- **Efecto de ruptura:** Fragmentación. La destrucción por segmentos se lee como una mini celebración.
- **Más rebote en cada golpe:** activado, para dar urgencia.
- **Duración:** 20 a 30 segundos.

**Consejo:** plantéalo como un reto con *«¿Podrá golpearlos todos en orden?»*.

## 7. Portal

Pares de portales del mismo color se sitúan en la pared. Tocar uno teletransporta la pelota a su gemelo con un ángulo de salida aleatorio. Tras cuatro usos el par de portales se agota y se convierte en una salida.

**Por qué funciona:** teletransportarse rompe la física que el espectador espera, lo que produce los momentos de «espera, ¿qué?» que impulsan las repeticiones.

**Ajustes sugeridos:**

- **Brillo de la pelota:** activado. Hace que el salto parezca intencionado.
- **Rastro de color:** activado. El rastro revela las trayectorias de teletransporte como geometría.
- **Efecto de ruptura:** Confeti.
- **Duración:** 20 a 30 segundos.

## 8. Fragmentación

Cada pared está dividida en segmentos con puntos de vida. La pelota daña el segmento que golpea y, tras suficientes golpes, ese segmento desaparece. Abre un camino a través de cada pared para escapar.

**Por qué funciona:** es el modo más parecido a un juego, un rompeladrillos en círculo. Ver una pared desmoronarse pieza a pieza es profundamente satisfactorio, y el momento en que todo un anillo se derrumba es un punto natural para volver a verlo.

**Ajustes sugeridos:**

- **Paredes:** 4 a 6 para un clip de 20 a 30 segundos, u 8 a 10 para una tensión más larga.
- **Más rebote en cada golpe:** activado. La pelota excava los segmentos cada vez más rápido.
- **Paredes arcoíris:** Degradado. Cada segmento hereda un color distinto, así que la pared parece una vidriera rompiéndose.
- **Duración:** 20 a 30 segundos.

## 9. Coincidir color

El único anillo está dividido en segmentos de colores y la pelota cambia de color en cada rebote. Un segmento solo se rompe cuando el color de la pelota coincide. Elimínalos todos para escapar.

**Por qué funciona:** añade una capa de puzle. Los espectadores siguen el color de la pelota y buscan en la pared un segmento que coincida, así que los rebotes con el color equivocado generan frustración y las coincidencias, alivio.

**Ajustes sugeridos:**

- **Número de colores:** 4 o 5. Menos colores significa coincidencias más frecuentes y mejor ritmo en un clip corto.
- **Más rebote en cada golpe:** activado. Se reinicia con cada coincidencia, así que la velocidad sube y baja.
- **Paredes arcoíris:** desactivadas. Aquí los colores de los segmentos son la historia.
- **Duración:** 20 a 30 segundos.

## 10. Crecer

La pelota está encerrada en un gran anillo sin salida. Cada rebote la hace un poco más grande, así que con el tiempo llena cada vez más la arena y los rebotes son más frecuentes.

**Por qué funciona:** es un ascenso lento con una pregunta evidente: ¿cuánto puede crecer? El contraste entre la pelota diminuta del inicio y la enorme del final es dramático por sí mismo.

**Ajustes sugeridos:**

- **Ritmo de crecimiento:** 5%, el valor por defecto, para un crecimiento suave y visible.
- **Obstáculo central:** activado para una física más caótica.
- **Líneas:** activadas con Arcoíris. El arte de hilos que se llena a medida que la pelota crece queda increíble.
- **Brillo de la pelota:** activado. El brillo crece con la pelota.
- **Duración:** 20 a 30 segundos.

**Consejo:** el texto *«¿Cuánto puede crecer?»* dispara la tasa de finalización porque el espectador necesita ver la respuesta.

## 11. Caída de pelotas

Esta vez sin anillos. Un tablero alto de clavijas y barras cortas llena el lienzo, y pelotas de distintos tamaños y pesos se sueltan desde arriba una tras otra. Cada golpe contra una clavija, una barra o una pared toca una nota cuyo tono depende del tamaño de la pelota, graves las grandes y agudas las pequeñas, así que la simulación compone su propia polirritmia hasta que la última pelota queda en reposo.

**Por qué funciona:** es el modo donde manda el sonido. El espectador mira con el volumen alto porque la imagen explica la música: una pelota pesada bajando por el tablero toca la línea de bajo mientras las pequeñas salpican notas agudas por encima. Activa Lluvia y la pieza no termina nunca.

**Ajustes sugeridos:**

- **Número de pelotas:** 12 a 20. Más pelotas, música más densa.
- **Variación de tamaño:** 60 a 80%, para que los tonos se repartan en un par de octavas.
- **Variación de gravedad:** 50% o más. Es lo que desincroniza el ritmo.
- **Escala:** Pentatónica en la sección Sonido. Cada nota cae en la tonalidad sean cuales sean los tamaños.
- **Intervalo de salida:** 0,3 a 0,5 s para una apertura clara; 0 para una ráfaga.
- **Duración:** 20 a 30 segundos, o Lluvia activada para un bucle.

**Consejo:** el texto *«Sube el volumen»* es aquí todo el gancho.

## 12. Formas que rebotan

Una caja rectangular en lugar de anillos. Cuadrados, círculos o logos estilo DVD se deslizan en línea recta a velocidad constante y se reflejan perfectamente en las paredes, y cada golpe toca la siguiente nota de la melodía o una de cuatro notas, una por pared. Cada forma lleva un número grande que hace cuenta atrás con cada rebote, destella, crece un poco y cambia de color; la simulación termina cuando todos los números llegan a cero. Varios logos a velocidades en proporción 2:3 o 3:4:5 golpean las paredes en esas mismas proporciones, y eso es la polirritmia; un logo que cae en una esquina toca una nota más fuerte e ilumina todo el encuadre.

**Por qué funciona:** es el meme del salvapantallas de DVD con una cuenta atrás encima. Todo el mundo sabe que la esquina llegará y nadie sabe cuándo, y los números dan a los espectadores un motivo para quedarse hasta que la última forma llega a cero.

**Ajustes sugeridos:**

- **Forma:** logo DVD para la recompensa de la esquina; cuadrados para los clips de cuenta atrás más limpios.
- **Número de formas:** 2 o 3 a 2:3 o 3:4:5 para una polirritmia que se oiga; 1 para una cuenta atrás pura.
- **Cuenta atrás:** de 30 a 60. La simulación termina sola cuando todas las formas llegan a cero.
- **Crecimiento por golpe:** 1 a 2 %, para que las formas sean claramente más grandes al final.
- **Escala:** pentatónica o mayor en la sección de sonido, para que las cuatro notas de las paredes siempre encajen.
- **Duración:** la que dé la cuenta atrás; el buscador de simulaciones puede elegir una semilla para una duración exacta.

**Consejo:** el texto *«Espera a la esquina»* hace el trabajo por ti.

## ¿Qué modo deberías usar?

- **Máximas visualizaciones:** Clásico o Multiplicar, los formatos más probados y de mayor alcance.
- **Máximos comentarios:** Objetivo o Coincidir color, porque las reglas de juego invitan a hablar de estrategia.
- **Máximos compartidos:** Pintar o Líneas, cuyos resultados finales hacen que la gente etiquete a un amigo.
- **Destacar:** Acumulación o Crecer, que todavía se usan poco.
- **Nostalgia arcade:** Fragmentación.
- **Repeticiones:** Portal.
- **Música y ritmo:** Caída de pelotas, donde cada golpe es una nota.
- **Nostalgia DVD y polirritmias:** Formas que rebotan, donde los logos hacen cuenta atrás y un golpe en la esquina es la recompensa.

La jugada real es **rotar**. Publica un clip Clásico el lunes, Multiplicar el miércoles y Coincidir color el viernes. La variedad mantiene fresco tu perfil, y cada modo atrae a una audiencia ligeramente distinta, lo que hace crecer tu alcance total más rápido que repetir un solo formato.

[Prueba los 12 modos ahora →](/es/simulator)`,
  },
  {
    slug: "10-satisfying-ball-physics-video-ideas-that-go-viral",
    locale: "es",
    title: "10 ideas satisfactorias de vídeos de física de pelotas que se vuelven virales",
    description: "¿Sin ideas? Diez conceptos probados de física de pelotas, cada uno con ajustes exactos, que funcionan de forma constante en TikTok, Reels y Shorts.",
    date: "2026-03-10",
    readingTime: "7 min de lectura",
    tags: ["ideas de contenido", "vídeos virales", "TikTok", "contenido satisfactorio", "ideas de vídeos"],
    content: `La física de pelotas es uno de los formatos más fiables en las plataformas de vídeo corto, pero no todos los clips funcionan. Los diez conceptos siguientes aparecen una y otra vez entre los vídeos con mejor rendimiento, y todos se pueden recrear en el simulador en pocos minutos. Incluimos los ajustes para que partas de una receta que funciona.

## 1. El escape clásico

**Modo:** Clásico · **Paredes:** 15 a 20 · **Más rebote:** activado

Una sola pelota gana velocidad dentro de una pila de anillos hasta romper el último. El espectador sabe que escapará pero no cuándo, y esa incógnita es todo el clip. Añade el texto «¿Escapará?».

**Por qué funciona:** premisa simple, recompensa satisfactoria, bucle perfecto.

## 2. La cascada de color

**Modo:** Clásico · **Paredes arcoíris:** Degradado · **Rastro de color:** activado · **Brillo de la pelota:** activado

El mismo escape, pero subido de intensidad visual. Los anillos en degradado producen un espectro mientras la pelota avanza hacia fuera, y el rastro pinta un patrón tras ella.

**Por qué funciona:** en un feed de vídeo apagado y real, un espectro de neón detiene el scroll solo por su aspecto.

## 3. El laberinto congelado

**Modo:** Acumulación · **Tiempo de escape:** 4 s · **Púas:** activadas

Cada pelota que agota su tiempo se congela y se convierte en obstáculo. Tras unas diez, la arena es un laberinto y la última pelota tiene que sortearlo.

**Por qué funciona:** la tensión crece. Cada pelota congelada hace más angustioso el siguiente intento.

## 4. La bomba de multiplicación

**Modo:** Multiplicar · **Pelotas generadas:** 3 a 5 · **Brillo de la pelota:** activado

Cada escape genera más pelotas. Con el valor en 5 la arena se llena en segundos y los comentarios se llenan de emojis de cabeza explotando.

**Por qué funciona:** sobrecarga visual, en el buen sentido.

## 5. El rompeladrillos

**Modo:** Fragmentación · **Paredes:** 8 a 10 · **Paredes arcoíris:** Degradado

Paredes hechas de ladrillos individuales que se van desprendiendo uno a uno. A diferencia de Clásico, donde un anillo se rompe de golpe, el progreso es visible todo el tiempo.

**Por qué funciona:** destruir es satisfactorio, y los segmentos rotos frente a los intactos actúan como una barra de progreso integrada.

## 6. El puzle de colores

**Modo:** Coincidir color · **Colores:** 4 a 5

La pelota va cambiando de color y solo rompe los segmentos que coinciden. El espectador desea el color correcto en cada rebote.

**Por qué funciona:** un gancho cognitivo. La gente no solo mira, predice.

## 7. El salto por portal

**Modo:** Portal · **Brillo de la pelota:** activado · **Rastro de color:** activado

Los portales lanzan la pelota al otro lado de la arena en pleno vuelo y el rastro revela las trayectorias como geometría.

**Por qué funciona:** romper la física esperada crea sorpresa, y la sorpresa impulsa las repeticiones.

## 8. La carrera de velocidad

**Modo:** Clásico · **Paredes:** 20 · **Gravedad:** 800+ · **Más rebote:** activado

Sube al máximo el número de paredes y la gravedad. La pelota se mueve tan rápido que se difumina y los tonos ascendentes de los rebotes se convierten en una banda sonora frenética. Graba 15 segundos.

**Por qué funciona:** la velocidad crea urgencia y una descarga de adrenalina difícil de saltar.

## 9. La marca en movimiento

**Modo:** cualquiera · **Imagen personalizada:** tu logo · **Texto superior:** tu eslogan · **Marca de agua:** @usuario

Pon tu logo o producto en la pelota, tu eslogan arriba y los colores de tu marca en las paredes. El resultado es un anuncio que no parece un anuncio.

**Por qué funciona:** el contenido de marca realmente entretenido se comparte; un logo rebotando es una novedad.

## 10. El reto de predicción

**Modo:** Objetivo · **Objetivos:** 8 · **Texto superior:** «¿Golpeará todos los objetivos?»

Los segmentos numerados deben golpearse en orden. Plantéalo como un reto, termina el vídeo justo antes del desenlace y publica la respuesta como segunda parte.

**Por qué funciona:** los ganchos de predicción y los cliffhangers están entre los mayores impulsores de seguidores en TikTok.

## Consejos extra para todas las ideas

- **Exporta en vertical (1080×1920).** Es el formato nativo de TikTok, Reels y Shorts.
- **Mantente entre 15 y 30 segundos.** Una tasa de finalización más alta se traduce en más alcance.
- **Añade audio en tendencia tras exportar.** Los sonidos de rebote se quedan; el sonido en tendencia ayuda al descubrimiento.
- **Publica en horas punta,** normalmente por la tarde-noche entre semana y a mediodía los fines de semana.
- **Usa hashtags relevantes** como #satisfying, #physics, #oddlysatisfying y #ballbounce.
- **Haz una serie.** Numera tus vídeos para que la gente los vea en cadena.

Cada idea de arriba lleva menos de cinco minutos de preparación. Guarda tus recetas favoritas como presets y podrás publicar un clip nuevo cada día.

[Empieza a crear →](/es/simulator)`,
  },
  {
    slug: "ball-bouncing-simulator-free-online-physics-sandbox",
    locale: "es",
    title: "Simulador de pelotas rebotando – sandbox de física gratuito online",
    description: "Qué es un simulador de pelotas rebotando en el navegador, qué añade ViralBalls sobre una demo básica de física y cómo empezar en menos de un minuto.",
    date: "2026-03-10",
    readingTime: "5 min de lectura",
    tags: ["simulador de pelotas", "sandbox de física", "herramienta gratuita", "juego de navegador", "pelota rebotando"],
    content: `¿Buscas un **simulador de pelotas rebotando** que funcione en tu navegador sin instalar nada? ViralBalls es un sandbox de física gratuito para ver, ajustar y grabar pelotas rebotando dentro de anillos concéntricos, con control total sobre gravedad, velocidad, colores y efectos.

## ¿Qué es un simulador de pelotas rebotando?

En su forma más simple, un simulador de pelotas modela cómo una pelota cae por la gravedad, rebota en las superficies e interactúa con obstáculos. En su forma más elaborada es un espectáculo caótico de color, sonido y destrucción, que es donde vive ViralBalls. A diferencia de los motores de física para desarrolladores de juegos, está hecho para cualquiera que quiera ver, personalizar y compartir movimiento satisfactorio: creadores, profesores, diseñadores o gente que simplemente lo encuentra relajante.

## Funciones clave

### Física ajustable

Ajusta la gravedad desde ligera como una pluma hasta aplastante, fija la velocidad de la pelota y activa el rebote creciente para que la pelota se acelere hasta atravesar las paredes. Cada cambio se aplica al instante sin reiniciar.

### Diez modos de juego

- **Clásico**: la experiencia original de la pelota escapando de los anillos.
- **Acumulación**: las pelotas que agotan su tiempo se congelan como obstáculos.
- **Multiplicar**: cada escape genera más pelotas.
- **Líneas**: los puntos de rebote se conectan formando arte de hilos.
- **Pintar**: la pelota colorea el círculo y un contador registra la cobertura.
- **Objetivo**: los segmentos numerados deben golpearse en orden.
- **Portal**: los portales lanzan la pelota al otro lado de la arena.
- **Fragmentación**: las paredes son ladrillos con puntos de vida.
- **Coincidir color**: solo los colores coincidentes rompen segmentos.
- **Crecer**: la pelota crece con cada rebote.
- **Caída de pelotas**: las pelotas caen entre clavijas y barras y cada golpe toca una nota según su tamaño.
- **Formas que rebotan**: cuadrados, círculos o logos estilo DVD rebotan en una caja, hacen cuenta atrás con cada golpe y tejen polirritmias.

### Efectos visuales

Paredes arcoíris en degradado o pulsantes, brillo de pelota y paredes, rastros de color, efectos de confeti, fragmentación y onda expansiva, fondos reactivos, imágenes o emojis personalizados en la pelota y textos superpuestos para títulos y marcas de agua.

### Exportación de vídeo integrada

Graba la simulación directamente desde el navegador en formato cuadrado (500×500), HD (1280×720), Full HD (1920×1080) o vertical de TikTok (1080×1920). Sin grabador de pantalla, sin posproducción.

### Presets y enlaces para compartir

Guarda una configuración que te guste y cárgala con un clic. La URL se actualiza al cambiar los ajustes, así que puedes guardar una configuración en favoritos o enviársela a un amigo.

## ¿Para quién es?

- **Creadores de contenido** que producen clips para TikTok, Reels y Shorts.
- **Profesores y estudiantes** que visualizan gravedad, elasticidad y momento.
- **Diseñadores y artistas** que usan el simulador como herramienta de arte generativo.
- **Cualquiera que quiera relajarse** unos minutos.

## Primeros pasos

1. Abre el simulador.
2. Pulsa **Iniciar simulador**.
3. Ajusta los parámetros en el panel derecho.
4. Elige un modo en las tarjetas bajo el lienzo.
5. Pulsa **Grabar vídeo** para exportar un clip.

Todo se ejecuta en el cliente. Nada se sube y no hay registro.

[Prueba el simulador ahora →](/es/simulator)`,
  },
  {
    slug: "the-science-behind-why-satisfying-videos-go-viral",
    locale: "es",
    title: "La ciencia detrás de por qué los vídeos satisfactorios se vuelven virales",
    description: "Bucles de predicción, ASMR visual, tensión y alivio, color y sonido: la psicología de los vídeos satisfactorios y cómo aplicarla en tus propios clips.",
    date: "2026-03-10",
    readingTime: "8 min de lectura",
    tags: ["psicología", "neurociencia", "contenido viral", "vídeos satisfactorios", "ASMR", "estrategia de contenido"],
    content: `Pelotas rebotando en patrones perfectos, slime estirándose, arena cortándose: lo «extrañamente satisfactorio» es uno de los géneros más grandes de internet. ¿Qué pasa en el cerebro cuando lo vemos, y por qué cuesta tanto parar? Aquí tienes un recorrido práctico por los mecanismos y lo que cada uno sugiere para los clips que haces.

## El bucle de predicción

La dopamina suele describirse como la sustancia del placer, pero se comporta más como una señal de predicción. Mientras ves una pelota rebotar dentro de anillos, el cerebro no deja de adivinar: ahora golpeará esa pared, está a punto de colarse por el hueco. Cada acierto confirmado es una pequeña recompensa, y cada sorpresa es una mayor porque el cerebro actualiza su modelo.

La física de pelotas es especialmente eficaz porque es determinista y a la vez caótica. Las reglas son reales, así que predecir parece posible; la complejidad hace imposible predecir con exactitud. El bucle nunca se resuelve.

**Para creadores:** prefiere configuraciones donde el resultado siga siendo incierto durante la mayor parte del clip, como Clásico con muchas paredes o el modo Objetivo.

## ASMR visual

La calma con hormigueo que la gente asocia con susurros y golpecitos también tiene una vertiente visual. El movimiento suave y continuo, los patrones repetitivos, la simetría y la armonía de color son relajantes de seguir. Los anillos concéntricos, los segmentos equidistantes y los patrones radiales apelan directamente a la preferencia del cerebro por el orden, y combinarlos con tonos de rebote ascendentes hace el efecto multisensorial.

**Para creadores:** mantén el movimiento suave, usa colores en degradado y no silencies los sonidos de rebote.

## Tensión y alivio

Cada clip satisfactorio esconde una historia: planteamiento, tensión creciente, clímax, resolución. La pelota empieza a rebotar, se acelera, falla el hueco unas cuantas veces y luego lo atraviesa en una explosión de confeti y sale libre. Es la misma forma que un chiste o un estribillo, comprimida en veinte segundos.

**Para creadores:** deja que la tensión crezca. Un anillo que se rompe en el primer rebote es un clímax desperdiciado. El rebote creciente y unas paredes extra alargan el arco.

## El instinto de compleción

El efecto Zeigarnik dice que las tareas sin terminar nos inquietan más que las terminadas. Una pelota que todavía no ha escapado es un bucle abierto, y el espectador se queda para cerrarlo. Los modos que hacen visible el progreso, como los segmentos que se desmoronan en Fragmentación o el contador de porcentaje de Pintar, amplifican el tirón.

**Para creadores:** muestra el progreso y, de vez en cuando, termina justo antes de la recompensa. «Segunda parte mañana» convierte un bucle abierto en un seguidor.

## El color

Los colores cálidos captan la atención y los fríos calman; un espectro completo hace ambas cosas por turnos, y por eso las paredes arcoíris suelen superar a los colores únicos. Los colores brillantes y saturados sobre fondo oscuro también sobreviven a las pantallas pequeñas y a las habitaciones luminosas.

**Para creadores:** paredes arcoíris en degradado sobre el fondo oscuro por defecto son una apuesta segura.

## El sonido

El sonido es la parte más infravalorada del formato. El tono ascendente señala progreso, el ritmo irregular pero físico de los rebotes es fácil de seguir para el cerebro, y el golpe percusivo en sí es un desencadenante clásico de ASMR. En plataformas que reproducen con sonido automáticamente, el primer rebote puede enganchar al espectador antes de que registre la imagen.

**Para creadores:** conserva el audio de los rebotes en la exportación. Superpón un sonido en tendencia si quieres, pero no lo sustituyas.

## Por qué al algoritmo también le gusta

Los clips satisfactorios optimizan las métricas que las plataformas premian: alta finalización porque la gente ve hasta el final, repeticiones porque cada ejecución es un poco distinta, compartidos porque «tienes que ver esto», comentarios porque los ganchos de predicción los invitan, y muy pocas señales negativas.

## En resumen

1. Mantén incierto el resultado durante la mayor parte del clip.
2. Haz visible el progreso.
3. Usa todo el espectro.
4. Conserva los sonidos de rebote.
5. Plantea el clip como una pregunta.
6. De vez en cuando, termina con un cliffhanger.
7. Quédate entre 15 y 30 segundos.

Los vídeos satisfactorios no son virales por accidente. Entender por qué retienen la atención te da una lista de comprobación para hacer vídeos que la retengan más tiempo.

[Crea tu propio clip satisfactorio →](/es/simulator)`,
  },
  {
    slug: "how-to-create-viral-ball-physics-videos",
    locale: "es",
    title: "Cómo crear vídeos virales de física de pelotas para TikTok, Reels y Shorts",
    description: "Por qué las simulaciones de pelotas rebotando siguen explotando en redes sociales, y un flujo de trabajo de cinco pasos para hacer una en el navegador sin software de edición.",
    date: "2026-03-09",
    readingTime: "6 min de lectura",
    tags: ["contenido viral", "TikTok", "redes sociales", "tutorial"],
    content: `Si has pasado algo de tiempo en TikTok, Reels o Shorts los has visto: una pelota rebotando entre anillos que se encogen, rompiendo paredes en una cascada de color y sonido. Estos clips alcanzan millones de visualizaciones con regularidad, y puedes hacer el tuyo en minutos.

## Por qué los vídeos de física de pelotas se vuelven virales

- **Anticipación de patrones.** El espectador no puede apartar la vista porque predice inconscientemente el siguiente rebote.
- **Recompensa satisfactoria.** El momento en que la pelota rompe una pared, sobre todo con confeti o una onda expansiva, es una pequeña dosis de dopamina.
- **Repetibilidad infinita.** La física es caótica, así que cada ejecución es distinta y la gente vuelve a verla.
- **Diseño sonoro.** Los tonos ascendentes de los rebotes detienen el scroll antes incluso de que la imagen se registre.
- **Apto para formato corto.** Un clip de 15 a 30 segundos no necesita historia y encaja en todas las plataformas.

## Qué añade ViralBalls

La mayoría de demos de pelota en círculo que hay en internet son muy básicas. ViralBalls está hecho para creadores: diez modos distintos, personalización visual completa, imágenes personalizadas y textos superpuestos, reproducción de melodías integrada, un buscador de semillas que produce una ejecución de duración exacta, presets y exportación MP4 en vertical. Es gratis, sin registro y sin marca de agua a menos que añadas la tuya.

## Tu primer clip en cinco pasos

### 1. Elige un modo

Empieza con **Clásico** si eres nuevo. Para algo más dinámico, prueba **Fragmentación** (los segmentos se rompen por separado) o **Coincidir color** (la pelota debe golpear los colores que coinciden).

### 2. Sube los efectos visuales

Activa **Paredes arcoíris** en modo Degradado, activa **Rastro de color** y pon el efecto de ruptura en **Todos** para el máximo impacto. ¿Prefieres un aspecto más limpio? Quédate con Confeti y un único color de acento.

### 3. Añade texto

Activa Mostrar opciones avanzadas y luego pon un gancho arriba como *«¿Escapará?»* y tu usuario abajo. El primero mantiene al espectador; el segundo trae seguidores.

### 4. Fija el formato

Elige **1080×1920 (vertical, TikTok)** en la sección Grabación y una duración de 15 a 30 segundos: lo bastante corta para mantener la atención, lo bastante larga para que la pelota escape.

### 5. Pulsa grabar

Pulsa Grabar vídeo. La simulación se ejecuta, el archivo se descarga automáticamente y lo subes a TikTok, Reels o Shorts.

## Consejos para más interacción

- **Usa el rebote creciente.** La pelota se acelera hacia un clímax natural.
- **Prueba una pelota personalizada.** Un logo, una cara o un meme de moda consiguen más comentarios.
- **Publica con constancia.** Con presets guardados, un clip nuevo lleva dos minutos.
- **Conserva el sonido.** Los tonos de rebote son parte del gancho.
- **Prueba distintos modos.** A algunas audiencias les encanta la geometría limpia de Clásico; otras quieren el caos de Multiplicar.

## Ideas por nicho

- **Marcas:** tu logo como pelota, tu eslogan arriba, tus colores en las paredes.
- **Cuentas de deportes:** un emoji de balón de fútbol o baloncesto y un texto «¿Marcará?».
- **Páginas de contenido satisfactorio:** todos los efectos activados, poca gravedad, deja que la imagen trabaje.
- **Educación:** demuestra gravedad, elasticidad y conservación de la energía.
- **Gaming:** Fragmentación y Objetivo se juegan como minijuegos; añade comentarios o un reto de predicción.

## Por qué ahora

El formato está probado pero aún no saturado, y la mayoría de creadores siguen grabando la pantalla de demos básicas. Un clip totalmente personalizado destaca al instante, y no requiere ninguna habilidad de edición: la simulación, los efectos y la grabación ocurren en tu navegador.

[Prueba ViralBalls ahora →](/es/simulator)`,
  },
];
