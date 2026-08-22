# Calendario — Deprocast OS

```
documento   : calendario.md
módulo      : Calendario (Trinchera · Campamento · Castillo)
versión     : 0.7.1
fecha       : 2026-08-20
```

El calendario no es una agenda gregoriana de oficina. Es el **tablero espacio-temporal** del sistema: cruza bitácoras reales (audios, notas, cuadernos, bookmarks) con tres escalas de foco — el día, la semana y el ciclo de 28 — y las pondera con correspondencias alquímicas, el tridente Cuerpo/Mente/Alma (3-6-9) y la Base Amazona 72.

Una sola dimensión visible a la vez. Cada vista es un subdominio autocontenido, para poder embeberse después en otras áreas del OS.

---

## 1. Las tres dimensiones

El flujo Q → W → E recorre futuro, rutina y presente. En teclado: `Alt` más la tecla física.

| Tecla   | Dimensión   | Escala     | Rol |
|---------|-------------|------------|-----|
| `Alt+E` | Trinchera   | Diario     | El ahora. Deep work, ingesta, Ayer / Hoy / Mañana. |
| `Alt+W` | Campamento  | Semanal    | Orquesta de la rutina. Matriz 6×6, planetas, tipologías. |
| `Alt+Q` | Castillo    | Ciclo 28   | Visión. Tapiz lunar, eclipses de Saturno, marea de nodos. |

Navegación equivalente por pestañas en la cabecera (`DimensionalNavigator`). El foco de fecha se desplaza con ← / Hoy / →: ±1 día en Trinchera, ±7 en Campamento, ±28 en Castillo.

La dimensión activa, el skin del reloj y el tridente se persisten en `localStorage`.

---

## 2. Trinchera — diario (`Alt+E`)

Pantalla de altura fija. Tres columnas:

1. **Reloj sensorial** (skins Analógico / Digital / Sensorial) y tridente **Cuerpo 3 · Mente 6 · Alma 9** (396 / 528 / 963 Hz). El analógico es una esfera **00–24 h**, no un reloj civil de 12: arcos Cuerpo 00–08, Mente 08–16, Alma 16–24.
2. **Ayer | Hoy | Mañana.** Hoy va encuadrado. Cada columna lista chips nativos del día (hora 24h y 12h, fuente, polo, título, tareas).
3. **Ingesta.** Audio a la cola + pipeline, o nota rápida al backlog.

Bloques circadiano del reloj sensorial (si no hay telemetría externa): Cuerpo hasta las 08, Mente hasta las 16, Alma el resto.

---

## 3. Campamento — semanal (`Alt+W`)

El lienzo es la **matriz 6×6** (36 celdas = una cara de la Base 72). Las columnas siguen las seis primeras correspondencias alquímicas de la semana (Lun–Sáb). Las tareas de la semana se arrastran a celdas; el mapa celda↔tarea vive en `localStorage` por lunes de semana (`deprocast.amazona.week:YYYY-MM-DD`).

Arriba: selector lun–dom (el domingo existe como día, no como séptima columna de la matriz).

Rail derecho:

- Planeta, glifo y etapa del día enfocado.
- **Base Amazona 72:** rotación 3×3×3 (índice 0–71, cara, celda, tridente x/y/z, suma y producto). Ilumina la celda de la cara 0 equivalente.
- Solfeggio del tridente × factor del día alquímico.
- Seis **tipologías** del catálogo de agentes (vectorizador, clasificador, crawler, generativo, ejecutivo, omnívoro) con estado `vivo` / `bosquejo` / `hueco`. No simulan trabajo.

Correspondencias de la semana:

| Día       | Planeta  | Etapa              |
|-----------|----------|--------------------|
| Lunes     | Luna     | Materia Prima      |
| Martes    | Marte    | Nigredo            |
| Miércoles | Mercurio | Albedo             |
| Jueves    | Júpiter  | Citrinitas         |
| Viernes   | Venus    | Rubedo             |
| Sábado    | Saturno  | El Cubo Negro      |
| Domingo   | Sol      | Piedra Filosofal   |

---

## 4. Castillo — ciclo 28 (`Alt+Q`)

No es un mes gregoriano. El tapiz es un **anillo de 28 días** anclado al lunes 6 ene 2020 (`CYCLE_EPOCH`). Cada cuenta muestra fase lunar del ciclo, glifo alquímico y, en pequeño, el día civil.

- Días **27 y 28** del ciclo: eclipse de Saturno (tratamiento oro/negro). Es una marca del motor, no efemérides astronómicas reales.
- Clic en un día: ese día pasa a ser el foco y la UI salta a Trinchera.
- Rail: oráculo corto según fase (nueva / creciente / llena / menguante / eclipse) y **marea lunar** sobre nodos ya sembrados en el mapa — Paterna, Horta Sud, Castillo Sagunto, Puerto Sagunto. El brillo usa `moonPhase` (iluminación sinódica): pilares torre/iglesia suben en luna nueva; el Reloj (Puerto Sagunto) sube en luna llena. No se incrusta el módulo Mapa.

Fases internas del ciclo 28:

| Días del ciclo | Fase       |
|----------------|------------|
| 1–2 y 27–28    | Luna nueva |
| 3–13           | Creciente  |
| 14–16          | Luna llena |
| 17–26          | Menguante  |

---

## 5. Motor

Archivo: `src/lib/calendar/engine.ts`.

- **Tridente 3-6-9.** Cuerpo / Mente / Alma. Hz base × `solfeggioFactor` del día.
- **Base Amazona 72.** `index % 72` → cara (0–1) + celda 0–35 (fila/col 6×6) + coordenadas 1..3 en x, y, z.
- **Ciclo 28.** `cycle28Containing(date)` → índice de ciclo, día lunar 1–28, vector de fechas.
- **Chips.** Un registro puede tener dos polos temporales: `ingested` (cuándo entró al sistema) y `native` (`timestamp_exact`, el momento del hecho). Si coinciden al minuto, se colapsan en un chip `ingesta · nativo`.

---

## 6. Datos

`GET /api/calendar/activity?from=&to=` (`server/routes/calendar.ts`) arma `CalendarOccurrence[]` desde:

- `entries` (audio, blob, chat, etc.) + `pending_tasks`
- páginas de cuaderno sin `entry_id`
- bookmarks huérfanos

`PATCH /api/calendar/tasks/:taskId` marca tareas hechas / no hechas.

La ingesta desde Trinchera reutiliza el pipeline general (`ingestAudioOne` + `runPipeline`, o `ingestBlob`).

---

## 7. Archivos

| Pieza | Ruta |
|-------|------|
| Shell y atajos | `src/components/calendario/CalendarioSection.tsx` |
| Pestañas | `src/components/calendario/DimensionalNavigator.tsx` |
| Diario | `src/components/calendario/TrincheraView.tsx`, `SensoryClock.tsx`, `ActivityChipList.tsx` |
| Semana | `src/components/calendario/CampamentoView.tsx` |
| Ciclo 28 | `src/components/calendario/CastilloView.tsx` |
| Motor | `src/lib/calendar/engine.ts` |
| API | `server/routes/calendar.ts` |
| Estilos | `src/index.css` (bloque Calendario dimensional) |

---

## 8. Fuera de este módulo (huecos)

No viven en el calendario, aunque las fuentes los nombren: telemetría Oura/HRV, NLP tipo `/paterna luna llena`, scrubber inferior tipo editor de video, HUD RPG (HP/MP/EXP), simulación Intención vs Colapso con agentes ejecutando, astronomía real de Saturno, Daily Thread como chat con Mastropiero.

El calendario lee lo que ya está en SQLite y organiza el tiempo. No inventa sensores ni oráculos generativos.
