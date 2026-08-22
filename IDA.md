# IDA

```text
documento   : IDA.md
producto    : Deprocast — núcleo /deprocast
qué es      : Investigación · Desarrollo · Aplicación
ancla       : matriz AmazonA ama-matrix-ida (6×6)
fecha       : 2026-08-20
```

IDA es el tablero donde el organismo se mejora a sí mismo. No es un segundo producto ni un wiki paralelo: es una **ficha** (`depro_ida_items`) que puede ser del **organismo** (módulos, agentes, deudas de código) o un **aprendizaje** (concepto destilado, anclado a una celda 6×6).

La operación diaria sigue en `/` (Zona franca → Aduana → Validada). El núcleo vive en `/deprocast`, accesible desde el footer **◇ núcleo**. Misma RUN, misma SQLite. El wipe de NUEVO USUARIO **no** borra IDA ni la Matrix 72.

```text
Ingesta → Celda 6×6 → Criba HITL (peso 1–12) → Quántomo
       → Grafo (vecinos) → Entrenamiento (cards + corpus) → Obra
```

---

## 1. Para qué existe

Tres preguntas, tres etapas:

| Letra | Etapa | Qué significa acá |
| ------- | -------- | ------------------- |
| **I** | Investigación | Hipótesis, hueco, “esto falta”. |
| **D** | Desarrollo | Ya hay cableado parcial o diseño. Se trabaja. |
| **A** | Aplicación | Constancia de que existe en código. Aplicar **no** reescribe TypeScript: deja rastro. Cargar el poder en código es el acto. |

Promover I→D→A en el kanban **sugiere** bajar una fila en el eje Y de la tabla (Solve → Coagula). El operador puede mover la ficha a otra celda a mano.

Sin peso HITL (1–12) un **aprendizaje** no baja a Coagula. Las fichas **organismo** (las 11 seeds del núcleo) no tienen esa traba: son backlog de producto, no destilado hermético.

---

## 2. Geometría AmazonA (Tabla IDA)

No hay un segundo motor. AmazonA ya sabe: **Lista6 = 2 tridentes**, matrices 6×6 en SQLite (`ama_lists`, `ama_lista6_parts`, `ama_matrices`, `ama_cells`). IDA usa esa geometría. Las celdas de `ama_cells` siguen siendo lazy (se crean al PATCH). Las fichas de aprendizaje **no** viven en `ama_cells`: viven en `depro_ida_items` con coordenada `(matrix_id, row_item_id, col_item_id)`.

Matriz fija: `ama-matrix-ida`.

### Eje Y — Proceso (Solve \| Coagula)

Lista6 `ama-lista6-ida-proceso`.

| Tridente | Ítem | Fila | Etapa IDA |
| ---------- | ------ | ------ | ----------- |
| **Solve** | Ingesta | nota / audio / ficha entra | Investigación |
| **Solve** | Criba | voto HITL 1–12 | Investigación |
| **Solve** | Quántomo | ficha destilada | Investigación |
| **Coagula** | Grafo | vecinos por embedding | Desarrollo |
| **Coagula** | Entrenamiento | flashcards + corpus | Desarrollo |
| **Coagula** | Obra | tarea / ticket / aplicar | Aplicación |

### Eje X — Dominio (Operador \| Territorio)

Lista6 `ama-lista6-ida-dominio`.

| Tridente | Ítem | Qué cubre |
| ---------- | ------ | ----------- |
| **Operador** | Biológico | soma, carga, cuerpo, sueño, comida |
| **Operador** | Sistémico | pipelines, agentes, software, bucle |
| **Operador** | Hermético | destilación, peso, sentido, quántomo |
| **Territorio** | Normativo | derecho, reglas, plazos, fuero |
| **Territorio** | Narrativo | relato, marco, comunicación |
| **Territorio** | Comunitario | personas, agrupaciones, plaza |

36 celdas. Un aprendizaje se crea **ya anclado** a una de ellas (vista Tabla). Un organismo puede no tener coordenada: el kanban I/D/A sigue valiendo.

Corruptópolis y Nodos Territoriales no se tocan. Esta matriz es otra.

---

## 3. Un solo objeto: la ficha

No hay tabla de “conceptos”. Se extiende `depro_ida_items`:

| Campo | Uso |
| ------- | ----- |
| `title`, `body` | enunciado y destilado |
| `stage` | `investigacion` \| `desarrollo` \| `aplicacion` |
| `kind` | `organismo` \| `aprendizaje` |
| `matrix_id`, `row_item_id`, `col_item_id` | celda AmazonA (nullable) |
| `weight` | voto HITL 1–12 (nullable) |
| `domain_ids` | Dominios entidad (Salud, Finanzas…) — ver §3.1 |
| `power_indexes` | slots 0–71 de la Matrix 72 |
| `agent_ids` | fichas del atelier |
| `tags`, `origin`, `archived` | igual que antes |

Flashcards en tabla liviana `depro_ida_cards`: `ida_id`, `question`, `answer`, `due_at`, `ease`.

Ambas van al **respaldo**. Ninguna está en `USER_ACTIVITY_TABLES`.

Seeds actuales del organismo (11 fichas, `kind=organismo`): Omnívoro, peso automático, diarizador, enrich de reels, crawler de links, Chronos, celdas del día AmazonA, contable, legista, nutrición/carga, triage de feedback.

### 3.1 Dominios (entidad)

Áreas de vida/conocimiento, distintas del eje X de la matriz (Biológico…Comunitario) y de los 8 dominios de la Matrix 72.

Tabla `dominios`. Cinco **fijos** (no se borran ni se renombran; sobreviven a NUEVO USUARIO):

| Id | Nombre |
|----|--------|
| `dom-salud` | Salud |
| `dom-finanzas` | Finanzas |
| `dom-derecho` | Derecho |
| `dom-tecnologia` | Tecnología |
| `dom-arte` | Arte |

El operador puede crear más a mano (Entidades → Dominios). Las fichas IDA los llevan en `domain_ids`. API: `/api/dominios`.

---

## 4. Bucle dual

### Máquina (corpus)

Al sellar un aprendizaje con cuerpo se hace upsert de embedding `object_type: 'ida_item'` (Mnemosyne, Cohere Embed, cosine en SQLite — el mismo patrón del grafo, sin sqlite-vss).

`GET /api/deprocast/ida/:id/neighbors` devuelve fichas y quántomos cercanos. Eso es **Grafo / Entrenamiento** del lado máquina.

### Operador (retención)

Pestaña **Academia** en `/deprocast/ida`: cards con `due_at <= ahora`. Pregunta → revelar → **Otra vez** (mañana, ease baja) o **Bien** (intervalo ≈ ease, ease sube). No es Anki completo.

El voto 1–12 en la ficha es la **Criba HITL**. Las cards son recall. No se mezclan.

Cohere (`POST /ida/:id/propose-cards`) propone 3 pares pregunta/respuesta. El operador las edita y sella. Las cards **no** pasan por Perplexity.

### 4.1 Cuarentena / Explorador (Perplexity)

Flujo **manual** (V1): el operador usa Perplexity Pro fuera de Deprocast.

1. **Generar Prompt** (`POST /research/prompt`) — plantilla estricta 6 ejes × 6 nodos JSON; se copia a Perplexity.
2. **Pegar Payload** (`POST /research/ingest`) — el JSON vuelto se parsea → pack `origin=manual` + hasta 36 hallazgos con `axis_index` / `node_index`.
3. HITL en la bandeja (tablero 6×6): asimilar → aprendizaje IDA + embed; descartar; fractalizar → **nuevo prompt** para copiar (no llama API); purga / asimilar pendientes.

La llamada API Sonar (`POST /research/run`, `origin=api`) queda cableada para más adelante; hoy no es el camino de la UI.

Tablas: `depro_research_packs` (`origin` manual|api), `depro_research_findings` (respaldo; no wipe NUEVO USUARIO). Env opcional futuro: `PERPLEXITY_API_KEY`, `PERPLEXITY_MODEL`, `PERPLEXITY_TIMEOUT_MS`.

Extra: `GET /api/deprocast/ida/export` — markdown de aprendizajes para pegar en un chat de Cursor cuando toque desarrollo. En Academia hay botón **Copiar export markdown**.

---

## 5. Superficie `/deprocast/ida`

Cuatro vistas internas (no son rutas nuevas):

1. **Tabla** — grid 6×6, lenguaje visual de AmazonA (no el widget del calendario). Conteo por celda. Clic: inspector, crear aprendizaje anclado, peso, proponer/sellar cards, vecinos.
2. **Tablero** — kanban I/D/A. Filtro organismo / aprendizaje / dominio. Crear desde Agentes o Matrix 72 aterriza acá (organismo por defecto; si es aprendizaje, se pide celda).
3. **Academia** — cola de recall + export.
4. **Cuarentena** — Generar Prompt → pegar JSON Perplexity → matriz 6×6 HITL.

Footer **◇ núcleo**. Matrix 72 y Agentes siguen al lado.

---

## 6. API (núcleo)

Prefijo `/api/deprocast`.

| Método | Ruta | Qué hace |
| -------- | ------ | ---------- |
| GET | `/catalog` | notes de poderes + fichas IDA + matriz hidratada |
| PATCH | `/powers/:index` | notas / status override de un poder 0–71 |
| GET | `/ida` | listar (`?archived=1`) |
| POST | `/ida` | crear (coordenada, peso, kind) |
| PATCH | `/ida/:id` | editar; promover sugiere fila Y |
| DELETE | `/ida/:id` | borra ficha, cards y embedding |
| GET | `/ida/due` | cola Academia |
| GET | `/ida/export` | markdown |
| GET | `/ida/:id/neighbors` | vecinos semánticos |
| POST | `/ida/:id/propose-cards` | 3 Q/A (Cohere o mock) |
| GET/POST | `/ida/:id/cards` | listar / crear card |
| PATCH/DELETE | `/ida/cards/:cardId` | editar / borrar card |
| POST | `/ida/cards/:cardId/review` | `{ grade: "again" \| "good" }` |
| GET | `/research/packs` | listar packs de cuarentena |
| GET | `/research/packs/:id` | pack + findings |
| POST | `/research/prompt` | `{ topic }` → prompt 6×6 para copiar a Perplexity |
| POST | `/research/ingest` | `{ payload }` → pack manual + nodos |
| POST | `/research/run` | `{ topic, agent_id }` → pack API async (futuro) |
| POST | `/research/findings/:id/assimilate` | hallazgo → aprendizaje IDA + embed |
| POST | `/research/findings/:id/discard` | descartar |
| POST | `/research/findings/:id/fractalize` | marca fractalizado + prompt hijo para copiar |
| POST | `/research/packs/:id/assimilate-pending` | asimilar todos los pending |
| POST | `/research/packs/:id/discard-pending` | purga rápida de pending |
| DELETE | `/research/packs/:id` | borrar pack + hallazgos de la bandeja (no toca IDA asimilado) |

---

## 7. Archivos

| Capa | Dónde |
| ------ | -------- |
| Seed matriz | `server/services/amazonaSeed.ts` (`seedIdaMatrix`) |
| Geometría IDs | `server/services/idaGeometry.ts`, `src/lib/deprocast/idaGeometry.ts` |
| Schema | `server/db.ts` |
| Servicio / API | `server/services/deprocast.ts`, `server/routes/deprocast.ts` |
| Research | `server/services/perplexity.ts`, `server/services/research.ts` |
| Embed | `server/services/embeddings.ts` (`ida_item`) |
| Cards LLM | `server/services/cohere.ts` (`proposeIdaCards`) |
| Respaldo | `server/services/backup.ts` |
| UI | `DeprocastIda.tsx`, `DeprocastIdaTable.tsx`, `DeprocastAcademia.tsx`, `DeprocastCuarentena.tsx` |
| Dominios | `server/services/dominios.ts`, `server/routes/dominios.ts`, `DominiosSection.tsx` |
| Catálogo 72 | `src/lib/deprocast/geometry.ts`, `powers.ts`, `agents.ts` |

Fuera de alcance a propósito: rotación Base 72 animada, luna, Enciclopediador genérico, clones, bloqueo de UI por sueño, Zustand, Next.js, automatizar Sonar por API en la UI (el endpoint existe), streaming token a token, quántomos desde research.

---

## Los 72 agentes

La Matrix no es un organigrama de personas. Es **8 dominios × 9 oficios = 72 celdas**. Cada celda es un **poder** (índice interno 0–71, número visible **01–72**). Un **agente** es una ficha con contrato Input \| Procesamiento \| Output que **ocupa** una o más celdas.

```text
poder  = slot geométrico (siempre 72)
agente = ficha viva / bosquejo / hueco que habita el slot
```

Hoy hay **35 agentes** nombrados en `AGENT_CATALOG` (incluye Explorador y perfiles académico/mercado). Cargar un hueco es acto de código (hardcode en `powers.ts` / `agents.ts`) más constancia en IDA, no magia de runtime.

### Cómo se calcula el slot

```text
index        = 0 … 71
visible      = index + 1   →  01 … 72
dominio      = floor(index / 9)     // 8 dominios
oficio       = index % 9            // 9 oficios
IPO          = floor(oficio / 3)    // Input, Procesamiento, Output
CMA          = oficio % 3           // Cuerpo, Mente, Alma
```

| Oficio | IPO | CMA |
| -------- | ----- | ----- |
| 0 | Input | Cuerpo |
| 1 | Input | Mente |
| 2 | Input | Alma |
| 3 | Procesamiento | Cuerpo |
| 4 | Procesamiento | Mente |
| 5 | Procesamiento | Alma |
| 6 | Output | Cuerpo |
| 7 | Output | Mente |
| 8 | Output | Alma |

Dominios, en orden:

| # | Id | Origen |
| --- | ---- | -------- |
| 0 | Captura | Zona franca, audio, blobs |
| 1 | Criba | Aduana, bookmarks, HITL |
| 2 | Biblioteca | Cuadernos, OCR, visión |
| 3 | Memoria | Quántomos, chats, NER, grafo |
| 4 | Territorio | Calendario, mapa, AmazonA |
| 5 | Finanzas | nuevo |
| 6 | Derecho | nuevo |
| 7 | Vitalidad | Salud, deporte, nutrición — y el Núcleo (72) |

Tipologías (rotan por celda si no hay override): Vectorizador, Clasificador, Crawler, Generativo, Ejecutivo, Omnívoro.

Estados: **hueco** (celda vacía), **bosquejo** (contrato, sin módulo cerrado), **cargado** (vive en código). El operador puede overlay de notas/status en SQLite (`depro_power_notes`) sin reescribir el catálogo.

---

## 7.1 Atelier: 32 fichas de agente

Estas son las fichas. Varias comparten poder (p. ej. Aduanero y Diarizador en **10**).

### Vivos (aplicados)

| Agente | Poderes | IPO resumido | Dónde vive |
| -------- | --------- | -------------- | ------------ |
| **Escriba** | 01 | Audio → Deepgram STT → transcripción en cola | `pipeline.ts`, `deepgram.ts` |
| **Blob** | 02 | Nota con @menciones → quántomo → nodo sin STT | BlobComposer |
| **Partidor** | 04 | Audio largo → split → hijos queued | `audioSplit.ts` |
| **Destilador** | 05, 35 | Texto → Cohere extract → proposal | `cohere.ts` |
| **Aduanero** | 10, 13 | pending_criba → peso + speakers HITL | CustomsPanel |
| **Cribador** | 11, 14 | Bookmark → scoring 1–12 + banda | CribaPanel |
| **Sello** | 17 | Proposal → approve/reject + embed/NER | proposals |
| **Visionario** | 19 | Foto/frame → OCR/Vision → texto + layout | `notebookOcr.ts` |
| **Exegeta** | 23, 26 | Página validada → explain + NER → corpus | notebooks |
| **Conversador** | 28 | Import .txt WhatsApp/redes → destilado + URLs (no es chat del producto) | ChatsSection |
| **Onomasta** | 29 | Menciones → create/link/merge | EntityHub |
| **Oráculo** | 30 | Pregunta + entity_refs → GraphRAG + Cohere → respuesta grounded | DialogoSection, `chat.md` |
| **Mnemosyne** | 32 | Corpus → Embed + Rerank → vectores | `embeddings.ts` |
| **Tejedor** | 33 | Co-ocurrencia + similarity → aristas | GraphWorkspace |
| **Cronista** | 37 | Occurrences → escala T/C/C → agenda | calendario |
| **Cartógrafo** | 38, 44 | lat/lng/H3 → occupancy → vista táctica | mapa |
| **Campo** | 41 | Listas + ciclo → celdas 3×3/6×6 | AmazonA |
| **Omnívoro** | 72 | El organismo entero → metaanálisis + IDA | este núcleo |
| **Explorador** | 34 | Prompt 6×6 → pegar JSON Perplexity → cuarentena HITL → aprendizaje | research / Cuarentena |

### Bosquejo / investigación

| Agente | Poderes | Qué falta |
| -------- | --------- | ----------- |
| **Diarizador** | 10 | Deepgram ya diariza; match speaker → persona |
| **Auto-peso** | 13 | Sugerir 1–12; hoy el peso es 100% humano |
| **Media enrich** | 14 | Frames → Vision → ocr_json (parcial) |
| **Link crawler** | 32 | `link_harvest` existe; cerrar fetch + summarize + embed |
| **Soma** | 64 | Señal de cuerpo → tridente Cuerpo; sin sensores |
| **Noos** | 65 | Atención / criba → qué merece foco hoy |
| **Pneuma** | 66 | Rito, ánimo, ciclo 28 → brújula |

### Hueco de dominio nuevo (sin módulo)

| Agente | Poderes | Contrato |
| -------- | --------- | ---------- |
| **Contable** | 46, 49 | Hechos económicos → libro mayor |
| **Tributario** | 52 | Calendario fiscal → deberes y evidencias |
| **Legista** | 55, 58 | Norma/expediente → ficha jurídica (no dictamen) |
| **Contractual** | 61 | Borrador → pacto versionado |
| **Médico-archivo** | 64 | Estudios/recetas → carpeta (nunca consejo clínico autónomo) |
| **Entrenador** | 68 | Carga/sueño/sesión → plan del día |
| **Nutricionista** | 71 | Comidas → mesa del día / semana |

---

## 7.2 Catálogo 01–72

Contrato IPO de cada slot. Si el nombre es `Poder NN`, la celda está **hueca**: hay geometría, no hay acto.

### Captura (01–09)

| # | Nombre | Estado | Oficio | Tipo | Agentes | Input → Procesamiento → Output |
| --- | -------- | -------- | -------- | ------ | --------- | -------------------------------- |
| 01 | **Escriba** | cargado | Input · Cuerpo | Vectorizador | Escriba | Archivo de audio → Deepgram + split → transcripción en cola |
| 02 | **Blob** | cargado | Input · Mente | Vectorizador | Blob | Texto del operador → destilar quántomo → nodo sin Aduana de audio |
| 03 | Poder 03 | hueco | Input · Alma | Crawler | — | Celda vacía |
| 04 | **Partidor** | cargado | Proc. · Cuerpo | Ejecutivo | Partidor | Audio largo → split → hijos queued |
| 05 | **Destilador** | cargado | Proc. · Mente | Generativo | Destilador | Texto fuente → título, quántomos, acciones, entidades → proposal |
| 06 | Poder 06 | hueco | Proc. · Alma | Omnívoro | — | Celda vacía |
| 07 | Poder 07 | hueco | Output · Cuerpo | Vectorizador | — | Celda vacía |
| 08 | **Manifiesto** | cargado | Output · Mente | Ejecutivo | — | Extract crudo → empaquetar proposal → pending_criba / pending_review |
| 09 | Poder 09 | hueco | Output · Alma | Crawler | — | Celda vacía |

### Criba (10–18)

| # | Nombre | Estado | Oficio | Tipo | Agentes | Input → Procesamiento → Output |
| --- | -------- | -------- | -------- | ------ | --------- | -------------------------------- |
| 10 | **Aduanero** | cargado | Input · Cuerpo | Clasificador | Aduanero, Diarizador | pending_criba → peso 1–12 + mapa de voces → listo para extract |
| 11 | **Cribador** | cargado | Input · Mente | Clasificador | Cribador | Post/reel → peso + banda de media → procesar o slop |
| 12 | Poder 12 | hueco | Input · Alma | Generativo | — | Celda vacía |
| 13 | **Balanza** | bosquejo | Proc. · Cuerpo | Clasificador | Aduanero, Auto-peso | Señal + contexto → sugerir peso hermético → draft HITL |
| 14 | **Cinta** | bosquejo | Proc. · Mente | Crawler | Cribador, Media enrich | Bookmark de peso alto → STT/OCR/frames → material para Destilador |
| 15 | Poder 15 | hueco | Proc. · Alma | Vectorizador | — | Celda vacía |
| 16 | Poder 16 | hueco | Output · Cuerpo | Clasificador | — | Celda vacía |
| 17 | **Sello** | cargado | Output · Mente | Ejecutivo | Sello | Proposal editada → firmar o descartar → approved + NER |
| 18 | Poder 18 | hueco | Output · Alma | Generativo | — | Celda vacía |

### Biblioteca (19–27)

| # | Nombre | Estado | Oficio | Tipo | Agentes | Input → Procesamiento → Output |
| --- | -------- | -------- | -------- | ------ | --------- | -------------------------------- |
| 19 | **Visionario** | cargado | Input · Cuerpo | Crawler | Visionario | Imagen de página → Unlimited-OCR / Vision → transcripción + layout |
| 20 | **Índice** | cargado | Input · Mente | Clasificador | — | Cuaderno → indexar 160 caras / spreads → mapa de estado |
| 21 | Poder 21 | hueco | Input · Alma | Ejecutivo | — | Celda vacía |
| 22 | Poder 22 | hueco | Proc. · Cuerpo | Omnívoro | — | Celda vacía |
| 23 | **Exegeta** | cargado | Proc. · Mente | Generativo | Exegeta | Página validada → comentar + NER → explanation |
| 24 | Poder 24 | hueco | Proc. · Alma | Clasificador | — | Celda vacía |
| 25 | Poder 25 | hueco | Output · Cuerpo | Crawler | — | Celda vacía |
| 26 | **Página viva** | cargado | Output · Mente | Generativo | Exegeta | Explain + entidades → materializar entry/quantomo → nodo en el corpus |
| 27 | Poder 27 | hueco | Output · Alma | Ejecutivo | — | Celda vacía |

### Memoria (28–36)

| # | Nombre | Estado | Oficio | Tipo | Agentes | Input → Procesamiento → Output |
| --- | -------- | -------- | -------- | ------ | --------- | -------------------------------- |
| 28 | **Conversador** | cargado | Input · Cuerpo | Vectorizador | Conversador | Export .txt → destilar el día → quántomo + URLs (import; no Diálogo) |
| 29 | **Onomasta** | cargado | Input · Mente | Clasificador | Onomasta | Menciones → HITL + matchmakers → grafo de entidades |
| 30 | **Oráculo** | cargado | Input · Alma | Omnívoro | Oráculo | Pregunta + entity_refs → GraphRAG + Cohere → respuesta grounded |
| 31 | Poder 31 | hueco | Proc. · Cuerpo | Vectorizador | — | Celda vacía |
| 32 | **Mnemosyne** | cargado | Proc. · Mente | Crawler | Mnemosyne, Link crawler | Texto del corpus → embed + rerank → vectores / suggested links |
| 33 | **Tejedor** | cargado | Proc. · Alma | Crawler | Tejedor | Co-ocurrencia + similarity → scoring → grafo confirmado / suggested |
| 34 | **Explorador** | cargado | Output · Cuerpo | Crawler | Explorador (+ académico, mercado) | Tema → prompt 6×6 → ingest JSON manual → hallazgos HITL |
| 35 | **Quántomo** | cargado | Output · Mente | Generativo | Destilador | Fuente destilada → peso hermético/humano → átomo en la biblioteca |
| 36 | Poder 36 | hueco | Output · Alma | Omnívoro | — | Celda vacía |

### Territorio (37–45)

| # | Nombre | Estado | Oficio | Tipo | Agentes | Input → Procesamiento → Output |
| --- | -------- | -------- | -------- | ------ | --------- | -------------------------------- |
| 37 | **Cronista** | cargado | Input · Cuerpo | Ejecutivo | Cronista | Occurrences del rango → escalar el día → agenda visible |
| 38 | **Cartógrafo** | cargado | Input · Mente | Crawler | Cartógrafo | Punto o hex H3 → place + occupancy → vista táctica |
| 39 | Poder 39 | hueco | Input · Alma | Vectorizador | — | Celda vacía |
| 40 | Poder 40 | hueco | Proc. · Cuerpo | Clasificador | — | Celda vacía |
| 41 | **Campo** | cargado | Proc. · Mente | Ejecutivo | Campo | Listas + ciclo → celdas del hoy → campo operativo AmazonA |
| 42 | Poder 42 | hueco | Proc. · Alma | Generativo | — | Celda vacía |
| 43 | Poder 43 | hueco | Output · Cuerpo | Ejecutivo | — | Celda vacía |
| 44 | **Habitar** | cargado | Output · Mente | Ejecutivo | Cartógrafo | Entidad + place → occupy / unoccupy → capa de ocupación |
| 45 | Poder 45 | hueco | Output · Alma | Vectorizador | — | Celda vacía |

### Finanzas (46–54) — dominio nuevo

| # | Nombre | Estado | Oficio | Tipo | Agentes | Input → Procesamiento → Output |
| --- | -------- | -------- | -------- | ------ | --------- | -------------------------------- |
| 46 | **Haber** | bosquejo | Input · Cuerpo | Vectorizador | Contable | Movimiento/factura/nota → normalizar → hecho contable crudo |
| 47 | Poder 47 | hueco | Input · Mente | Vectorizador | — | Celda vacía |
| 48 | Poder 48 | hueco | Input · Alma | Clasificador | — | Celda vacía |
| 49 | **Contable** | bosquejo | Proc. · Cuerpo | Clasificador | Contable | Hechos crudos → cuenta, periodo, proyecto → libro mayor |
| 50 | Poder 50 | hueco | Proc. · Mente | Generativo | — | Celda vacía |
| 51 | Poder 51 | hueco | Proc. · Alma | Ejecutivo | — | Celda vacía |
| 52 | **Flujo** | bosquejo | Output · Cuerpo | Ejecutivo | Tributario | Libro + calendario → proyectar → deberes y liquidez |
| 53 | Poder 53 | hueco | Output · Mente | Vectorizador | — | Celda vacía |
| 54 | Poder 54 | hueco | Output · Alma | Clasificador | — | Celda vacía |

### Derecho (55–63) — dominio nuevo

| # | Nombre | Estado | Oficio | Tipo | Agentes | Input → Procesamiento → Output |
| --- | -------- | -------- | -------- | ------ | --------- | -------------------------------- |
| 55 | **Norma** | bosquejo | Input · Cuerpo | Vectorizador | Legista | Ley, expediente, nota → tematizar fuero y plazos → ficha jurídica |
| 56 | Poder 56 | hueco | Input · Mente | Clasificador | — | Celda vacía |
| 57 | Poder 57 | hueco | Input · Alma | Crawler | — | Celda vacía |
| 58 | **Legista** | bosquejo | Proc. · Cuerpo | Clasificador | Legista | Ficha + partes → riesgo, plazos, huecos → opinión de archivo (no dictamen) |
| 59 | Poder 59 | hueco | Proc. · Mente | Ejecutivo | — | Celda vacía |
| 60 | Poder 60 | hueco | Proc. · Alma | Omnívoro | — | Celda vacía |
| 61 | **Pacto** | bosquejo | Output · Cuerpo | Generativo | Contractual | Borrador + partes → redactar / contrastar → cláusula viva |
| 62 | Poder 62 | hueco | Output · Mente | Clasificador | — | Celda vacía |
| 63 | Poder 63 | hueco | Output · Alma | Crawler | — | Celda vacía |

### Vitalidad (64–72)

| # | Nombre | Estado | Oficio | Tipo | Agentes | Input → Procesamiento → Output |
| --- | -------- | -------- | -------- | ------ | --------- | -------------------------------- |
| 64 | **Soma** | bosquejo | Input · Cuerpo | Omnívoro | Médico-archivo, Soma | Señal somática → traducir a Cuerpo → ajuste del día |
| 65 | **Noos** | bosquejo | Input · Mente | Omnívoro | Noos | Carga cognitiva de la RUN → traducir a Mente → qué merece foco |
| 66 | **Pneuma** | bosquejo | Input · Alma | Omnívoro | Pneuma | Ánimo, rito, luna → traducir a Alma → brújula |
| 67 | Poder 67 | hueco | Proc. · Cuerpo | Ejecutivo | — | Celda vacía |
| 68 | **Carga** | bosquejo | Proc. · Mente | Ejecutivo | Entrenador | Sesión + recuperación → leer el ciclo → plan del día |
| 69 | Poder 69 | hueco | Proc. · Alma | Vectorizador | — | Celda vacía |
| 70 | Poder 70 | hueco | Output · Cuerpo | Clasificador | — | Celda vacía |
| 71 | **Mesa** | bosquejo | Output · Mente | Generativo | Nutricionista | Comidas y compras → patrones → mesa del día |
| 72 | **Núcleo** | cargado | Output · Alma | Omnívoro | Omnívoro | El organismo entero → metaanálisis + IDA → agentes y poderes que se mejoran a sí mismos |

El **72** es el Omnívoro: Deprocast que se lee a sí mismo. Cataloga, sugiere, guarda el tablero. Todavía no ejecuta un LLM de orquestación.

---

## 8. Cómo se usa (operador)

1. Abrir **◇ núcleo** → IDA → **Tabla**.
2. Elegir celda (proceso × dominio). Crear aprendizaje. Destilar el cuerpo.
3. Votar peso 1–12 (Criba). Sin peso no hay Coagula.
4. **Proponer 3 cards**, editar, sellar. El embedding se dispara al guardar cuerpo.
5. **Academia** cuando toque recordar. **Copiar export markdown** cuando toque pegarlo en un chat de desarrollo.
6. Lo que es deuda de *producto* (no concepto) va al **Tablero** como `organismo`, enlazado a poderes/agentes desde Matrix 72.

Cargar un hueco de los 72: escribir contrato en `src/lib/deprocast/powers.ts` (y ficha en `agents.ts` si nace un agente), dejar constancia en IDA etapa Aplicación, implementar el módulo. El catálogo hardcodeado es la fuente; SQLite solo guarda overlay del operador.
