# Deprocast 0.7.1 — Informe de madurez (2026-09-04)

```text
documento   : reporteseptiembre4.md
producto    : Deprocast 0.7.1 local
qué es      : Medición contra el plan de armado (1–12) + oleada de código
midió       : código en repo, no el mito de los .md anteriores
fecha       : 2026-09-04
después de  : reporte0708.md · v0.7.1.md · rumbo.md · audio.md · auditoria2608.md
```

Este informe es la fuente de verdad al 4 de septiembre de 2026. [`reporte0708.md`](reporte0708.md) y [`v0.7.1.md`](v0.7.1.md) describen un estado anterior (Mastropiero sin HTTP, entidades sin rail). Eso ya no es cierto. Lo que sigue se leyó en rutas, servicios y UI.

Escala: **1** no existe · **6** hay código usable con huecos serios · **9** opera en el camino feliz · **12** cerrado y excelente.

---

## 0. Cómo leer

Deprocast 0.7.1 es un organismo **local-first**: captura → voto humano 1–12 → memoria. El plan de armado pide un sistema capaz de:

1. Ingerir documentos, webs, audios, imágenes, telemetría y logs/data estructurada
2. Extraer texto, metadata, entidades, relaciones, eventos y afirmaciones verificadas
3. Normalizar en modelo documental, relacional y/o grafo
4. Indexar con búsqueda léxica, vectorial e híbrida
5. Capas RAG / GraphRAG con trazabilidad a la fuente original
6. Automatizar actualizaciones, evaluar calidad y detectar contradicciones

Arquitectura de lectura: **input | procesamiento | conocimiento | índice | interacción | recursividad**.

La sección 5 lista **qué cambia este plan** (código A/B/C). La sección 6 lista lo que **no** se toca aquí.

---

## 1. Flujo real (as-is)

```text
PUERTAS
  Zona franca .m4a/.mp3/.ogg     → queued → STT Deepgram → pending_criba
  El Cofre (extensión MV3)       → pending_criba (sin re-STT) + cofre.json
  Directo (mic live)             → RAM; no persiste
  Blobs / notas                  → entry texto
  Biblioteca (PDF, foto, audio, Excel, JSON)
  Bookmarks X + Instagram        → criba 1–12 → process por banda
  Chats .txt (WhatsApp / redes)  → bloques → destilado proto
  Cuarentena / Perplexity        → packs HITL → IDA
                                 ↓
ADUANA / CRIBA / HOJA            voto 1–12
                                 ↓
EXTRACTO                         Groq / Cohere / Ollama
                                 quántomos · acciones · NER (6 tipos)
                                 ↓
CONOCIMIENTO                     entries + vault
                                 persons / projects / agrupaciones / geo
                                 quantomos (proto → pre → sealed + L72)
                                 entity_links / person_project_links
                                 ↓
ÍNDICE                           FTS5 (personas, proyectos, quántomos)
                                 Mnemosyne (cosine en SQLite)
                                 ↓
CONSULTA                         Diálogo (Oráculo) · Grafo Babel · Sentinela
                                 Terminar hilo → proto otra vez
```

Persistencia: SQLite `data/deprocast.db` + `vault/`. Server en `127.0.0.1`. Token local. No hay Prisma.

Módulos de superficie ([`src/App.tsx`](src/App.tsx)): dashboard, franca, directo, aduana, validada, entidades, quantomos, grafo, criba, biblioteca, chats, dialogo, sentinela, respaldo, configuracion, calendario, amazona, mapa, atlas, aleph.

---

## 2. Capas de arquitectura (1–12)

| Capa | Nota | Evidencia |
|------|------|-----------|
| **Input — 8** | Muchas puertas reales. Falta ingest único de DOCX/HTML, logs de sistema y sensores. Directo no escribe DB. | [`server/routes/ingest.ts`](server/routes/ingest.ts), [`cofreIngest.ts`](server/services/cofreIngest.ts), [`notebookSources.ts`](server/services/notebookSources.ts), [`bookmarkProcess.ts`](server/services/bookmarkProcess.ts) |
| **Procesamiento — 7** | STT, OCR, extract y HITL sólidos. Enhance y silencedetect corrían **después** del STT (F1 de este plan los adelanta). | [`pipeline.ts`](server/services/pipeline.ts), [`audioAnalysis.ts`](server/services/audioAnalysis.ts), [`notebookOcr.ts`](server/services/notebookOcr.ts) |
| **Conocimiento — 8** | Triple modelo (doc + relacional + grafo). Hito se materializa como `project.category='hito'`. Embudo proto/pre/sealed existe y no es universal en todas las puertas. | [`db.ts`](server/db.ts), [`quantomoStages.ts`](server/services/quantomoStages.ts), [`groqExtractor.ts`](server/services/groqExtractor.ts) |
| **Índice — 5** | FTS5 acotado. Vectores buenos. «Hybrid» del grafo era léxico y semántica solo si el léxico venía vacío. `hybridScore` L72 no se llamaba. Rerank en settings, sin cable. | [`graph.ts`](server/services/graph.ts) `searchGraphNodes`, [`embeddings.ts`](server/services/embeddings.ts), [`lattice72.ts`](server/services/lattice72.ts) |
| **Interacción — 8** | Superficie amplia y usable. Citas del Oráculo eran chips no clicables, sin línea de fuente. | [`DialogoSection.tsx`](src/components/dialogo/DialogoSection.tsx), [`GraphSection.tsx`](src/components/GraphSection.tsx) |
| **Recursividad — 5** | Cerrar hilo → proto; research anida findings; Sentinela skills HITL; jobs con lease. No hay bucle automático de calidad ni contradicciones. | [`dialogo.ts`](server/services/dialogo.ts), [`jobs.ts`](server/services/jobs.ts), [`sentinel.ts`](server/services/sentinel.ts) |

Promedio de capas (antes de la oleada): **~6.8**.

---

## 3. Capacidades del plan de armado (1–12)

### 3.1 Ingesta — global **7**

| Ítem | Nota | Evidencia |
|------|------|-----------|
| Documentos **7** | PDF e imágenes de cuaderno; blobs de texto. No hay DOCX ni HTML genérico como corpus. | [`notebookIngest.ts`](server/services/notebookIngest.ts), [`blobIngest.ts`](server/services/blobIngest.ts) |
| Webs **6** | Bookmarks X/IG, harvest de URLs del corpus, Perplexity/JSON en cuarentena. No hay crawl de página completa. | [`bookmarks`](server/routes/bookmarks.ts), [`linkHarvest.ts`](server/services/linkHarvest.ts), [`research.ts`](server/services/research.ts) |
| Audios **9** | Franca, Directo, Cofre, audio de cuaderno, IG peso 7–9. Canal más maduro. Deepgram cloud; split > 22 min. | [`pipeline.ts`](server/services/pipeline.ts), [`deepgram.ts`](server/services/deepgram.ts), [`liveWs.ts`](server/liveWs.ts) |
| Imágenes **8** | OCR de hoja + Vision en IG 10–12 + editor de recorte. No hay corpus de fotos sueltas fuera de Biblioteca/IG. | [`notebookOcr.ts`](server/services/notebookOcr.ts), [`cuaderno.md`](cuaderno.md) |
| Telemetría **4** | `cofre.json` (URL/título/permanencia de pestaña). Aleph es sliders BPM/EEG, no hardware. | [`cofre.md`](cofre.md), [`src/aleph/telemetry.ts`](src/aleph/telemetry.ts) |
| Logs / data estructurada **5** | Overlay Excel/JSON en cuaderno, `ig_export.json`, WhatsApp `.txt`. No hay pipeline de syslog/CSV operativo. | [`notebookSources.ts`](server/services/notebookSources.ts) |

### 3.2 Extracción — global **6**

| Ítem | Nota |
|------|------|
| Texto **9** | STT, OCR espacial, parse de chat, transcripts de reels. |
| Metadata **7** | Origen por filename, diarización, silencios, `video_meta`. Sin densidad acústica / dB de fondo. |
| Entidades **8** | NER Persona / Proyecto / Agrupacion / Artefacto / Ubicacion / Hito + matchmakers HITL + geo. |
| Relaciones **8** | `entity_links`, `person_project_links`, `person_relations`, co-ocurrencia sugerida. |
| Eventos **4** | Hito se guarda como proyecto (`category='hito'`). `pending_tasks` alimentan el calendario. No hay tabla de eventos. |
| Afirmaciones verificadas **2** | El voto 1–12 puntúa la **fuente**, no un claim contra evidencia. No hay NLI ni triples verificables. |

### 3.3 Normalización — global **9**

Fortaleza del sistema. Documental (`entries` + vault + `pages`), relacional (CRM SQLite), grafo (Babel + aristas HITL). El modelo aguanta el producto. El precio: Hito y eventos no tienen tipo propio; Artefacto también cae a `projects`.

### 3.4 Indexación — global **5** (híbrida **3** antes de A)

| Ítem | Nota |
|------|------|
| Léxica **7** | FTS5 `persons_fts`, `projects_fts`, `quantomos_fts`. Typeahead inmediato. No hay FTS de transcripts/`entries`. |
| Vectorial **8** | Cohere Embed v4, JSON en SQLite, cosine in-process, `text_hash` idempotente, vecinos cacheados. Solo sellados en quántomos. |
| Híbrida **3** | `searchGraphNodes({ mode: 'hybrid' })` pedía semántica **solo si el léxico devolvía cero**. `hybridScore` (0.25 FTS · 0.40 embed · 0.35 L72) existía y **no se invocaba**. Oráculo: dense primero; FTS solo si no había seed quántomo. `COHERE_RERANK_MODEL` en env, no cableado. Persons/projects `/search` sí fusionaban con `Math.max`. |

### 3.5 RAG / GraphRAG — global **6** (trazabilidad **5** antes de B)

| Ítem | Nota |
|------|------|
| RAG sellado **7** | [`retrieveOracleContext`](server/services/graph.ts) + contrato [`shared/oracleRag.ts`](shared/oracleRag.ts). Sin entries crudas. Reply fijo si no hay evidencia. Tests en [`tests/oracleRag.test.ts`](tests/oracleRag.test.ts). |
| GraphRAG **7** | Seeds + vecinos 1-hop (persona↔proyecto, quántomos hermanos, `entity_links`). |
| Trazabilidad a fuente original **5** | Cita `type` / `id` / `label` del grafo. El prompt a veces trae `via entity_links:{entry_id}`. No hay timestamp de grabación, slot de hoja ni chip clicable. |

### 3.6 Automatizar / calidad / contradicciones — global **4**

| Ítem | Nota |
|------|------|
| Actualizaciones **6** | `app_jobs` con lease/generación/DLQ. Pipeline recupera `processing` huérfano. Colas notebook/bookmark/research. Disparo casi siempre del operador, no un scheduler. |
| Evaluación de calidad **7** | HITL 1–12, modo slop, `maxQuantomosForWeight`, criba de bookmarks por banda. No hay eval automática (nDCG, contradicción, drift). |
| Contradicciones **1** | No hay módulo. |

---

## 4. Mapa rápido módulo × capacidad

| Módulo | Rol en el tubo | Madurez percibida |
|--------|----------------|-------------------|
| Franca / pipeline / Aduana | Kernel audio HITL | Alto |
| Cofre | Sesión viva → criba | Código listo; runtime Chrome no auditado aquí |
| Directo | Oído vivo | Alto en RAM; cero persistencia |
| Biblioteca | Papel → OCR → corpus | Alto en el camino de hoja |
| Criba X/IG | Web social | Alto |
| Chats import | Destilado | Medio (alineación proto) |
| Diálogo | RAG | Medio (retrieve sí, cita pobre) |
| Grafo | Conocimiento + zoom | Alto visual; búsqueda híbrida débil |
| Mnemosyne | Índice vectorial | Alto para el volumen local |
| Calendario / AmazonA | Tiempo / campo | Medio |
| Sentinela | Recursión sobre el producto | Medio |
| Aleph | Telemetría teatral | Bajo como sensor |
| Research / IDA | Web mediada | Medio |
| Finanzas / Derecho | Ausentes a propósito | 1 |

---

## 5. Cambios de este plan (código)

Oleada acotada. Tres cierres con ganchos que ya existían. Sin tablas de claims, sin ONNX, sin Whisper.

### A — Índice híbrido real

**Qué.** `hybrid` pasa a ser fusión, no fallback. [`searchGraphNodes`](server/services/graph.ts) une typeahead FTS + `searchSimilar` (mismo patrón que personas). [`retrieveOracleContext`](server/services/graph.ts) mezcla dense + FTS de quántomos sellados siempre. Si el quántomo tiene lattice, entra [`hybridScore`](server/services/lattice72.ts) (0.25 / 0.40 / 0.35). El command palette del grafo pide `mode: 'hybrid'`.

**No entra.** Rerank Cohere. FTS de entries crudas como semilla del Oráculo.

**Puntuación buscada:** híbrida 3→7 · índice global 5→7.

### B — Trazabilidad RAG a la fuente

**Qué.** El Oráculo sigue bebiendo **solo sellados**. `OracleCitation` gana `entry_id`, `source_kind`, `timestamp_exact`, `locator` (p. ej. `page:8`). El bloque de prompt lleva línea `fuente:`. Chips clicables en Diálogo (quántomo → Corpus; persona/proyecto → Entidades).

**No entra.** Abrir el player en el `t=` del wav. Entries crudas en el retrieve.

**Puntuación buscada:** trazabilidad 5→8 · RAG global 6→8.

### C — Acoustic Guardian F1

**Qué.** Antes de Deepgram: highpass 80 Hz + denoise + loudnorm **I=−16** (el diseño de [`audio.md`](audio.md) pedía −14; se deja −16 por headroom / coincidencia con el filtro ya cableado). Opcional: concat ffmpeg de `speech_regions` → `sterile.m4a`. Flags `AUDIO_STERILE_BEFORE_STT` (default on) y `AUDIO_CONCAT_SPEECH_BEFORE_STT`. Sin ffmpeg, el camino crudo de siempre. Directo y Cofre no se tocan.

**Puntuación buscada:** procesamiento 7→8. Audio canal se mantiene en 9 (la puerta ya era la más madura; cambia la física de entrada al STT).

Tras A+B+C el organismo no se vuelve un 12. Se cierra deuda que ya tenía gancho. Contradicciones, claims y Whisper siguen en 1–2.

---

## 6. Fuera de este plan

- F2 Silero VAD, F3 Whisper local-first, F4 VAD en el socket live
- Motor de contradicciones y afirmaciones verificadas
- Eventos como tabla (Hito deja de ser un proyecto disfrazado)
- Telemetría Oura / logs de sistema / EEG real
- Crawl web genérico y DOCX
- Rerank Cohere y `entries_fts` como semilla del Oráculo
- Verificar El Cofre con load unpacked en Chrome (sigue siendo Horizonte A de [`rumbo.md`](rumbo.md))

---

## 7. Deuda residual (prioridad)

1. **Contradicciones** — el agujero de verdad del plan de armado (capacidad 6 = 1).
2. **Eventos / claims** — Hito y tareas no son un grafo temporal verificable.
3. **Unificar puertas a proto** — bookmarks y algunos caminos aún pueden nacer demasiado listos; ver [`quantomos.md`](quantomos.md).
4. **Castillo = único `recognized=1`** — RAG ya filtra `sealed`; el sello L72 no cubre el backfill histórico.
5. **Índice a escala** — vectores JSON + cosine in-process aguanta cientos, no decenas de miles.
6. **Guardian F2–F4** — cuando F1 esté verde en caminatas reales.

---

## 8. Verificación de esta oleada (2026-09-04)

- `npm test`: 53 tests, 13 files, verde (incluye `oracleRag` e `audioAnalysis`).
- `npm run typecheck`: web + server + extensión, verde.
- UI Diálogo/grafo: **no** se recorrió en browser. `127.0.0.1:5173` y `:3001` no respondían en el momento del cierre. Al arrancar `npm run dev`, conviene: command palette del grafo (híbrido), una pregunta en Diálogo (chips + `fuente:`), y un `.m4a` en franca si hay ffmpeg (`[pipeline] … F1 STT ← enhanced.m4a`).

---

## 9. Veredicto

0.7.1 **no** es un prototipo. Input, conocimiento e interacción están en el tercio alto (7–9). El plan de armado se cae en **índice híbrido**, **cita a la onda/página** y sobre todo **contradicciones**. Esta oleada ataca los dos primeros. El tercero espera un diseño propio, no un gancho olvidado.
