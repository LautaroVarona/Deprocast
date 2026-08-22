# Biblioteca / Cuadernos

La sección **Biblioteca** es el canal de Deprocast para cuadernos (físicos fotografiado o digitales dibujados). Cada cuaderno es un objeto de 80 hojas / 160 caras. El operador importa fuentes, el sistema transcribe con visión, el humano aprueba hoja por hoja, la IA explica, y recién ahí cada página entra al corpus como `entry` + `quantomo` (sin pasar por Trinchera ni Aduana).

Trinchera es *otro* cuaderno, de `kind=system`, sembrado al iniciar la DB. Ahí caen audios, chats e Instagram. **No aparece en Biblioteca** y las rutas de cuaderno lo rechazan.

## Dónde vive

| Capa | Archivo |
| ------ | --------- |
| UI lista + lector | `src/components/BibliotecaSection.tsx` |
| HITL por hoja | `src/components/PageValidationPanel.tsx` |
| Validar explicaciones | `src/components/ExplanationValidationPanel.tsx` |
| Recorte / rotación | `src/components/PageImageEditor.tsx` |
| Lienzo digital | `src/components/DigitalPageEditor.tsx` |
| API | `server/routes/notebooks.ts` |
| Layout 160 caras | `server/services/notebookLayout.ts` |
| CRUD + índice | `server/services/notebookPages.ts` |
| Ingesta imagen/PDF | `server/services/notebookIngest.ts` |
| Fuentes mixtas | `server/services/notebookSources.ts` |
| Colas visión / explain / corpus | `server/services/notebookProcess.ts` |
| Router OCR | `server/services/notebookOcr.ts` |
| Unlimited-OCR | `server/services/unlimitedOcr.ts` |
| Cohere Vision / explain / NER | `server/services/cohere.ts` |
| Cliente | `src/services/api.ts` (`api.*Notebook*`) |

En Deprocast Academia el módulo se llama `biblioteca`; agentes **Visionario** (OCR) y **Exegeta** (explicación + NER).

## Flujo del operador

```text
Crear cuaderno (físico | digital)
  → Fuentes: PDF / fotos / audio / nota / Excel / JSON
      PDF e imágenes → PNG en slots, status PendienteVision (OCR aún no corre)
      Audio → Deepgram STT, queda como contexto del cuaderno
      Nota con «pág. N» → explanation_user de esa hoja; si no, anexo
      Planilla → overlay de título/notas por página
  → «Procesar cuaderno»  → cola de visión (OCR)
  → Clic en la hoja      → Transcripción HITL
      editar / Re-visión / recortar / separar spread
      Aprobar transcripción  → Validada
  → «Generar explicaciones» (hojas `Validada`; OCR ya listo)
  → «Validar explicaciones» → imagen | texto, peso 1–12, Integrar → corpus
  → «Enviar al corpus»   → atajo sin valorar (peso 7 si falta)
                         → entry approved + quantomo universe=cuaderno
                         → embeddings Mnemosyne
  → «Exportar»           → ZIP con imágenes + JSON por hoja
```

Importar **no** dispara OCR. Las fotos quedan en `PendienteVision` hasta «Procesar cuaderno» o «Re-visión» en una hoja. Recortar, reemplazar imagen o separar un spread sí encola visión de inmediato.

## Tipos de cuaderno

| `kind` | Qué es | En Biblioteca |
| -------- | -------- | ---------------- |
| `fisico` | Fotos / PDF de un cuaderno de papel | sí |
| `digital` | Igual layout + botón **Lienzo** (lápiz, línea, rect, texto, goma) | sí |
| `system` | Trinchera: cubo de audio/chat/IG | no |

Al crear se insertan **160 filas vacías** en `pages` (`total_sheets=80`, `total_faces=160`). Borrar un cuaderno de producto elimina páginas, fuentes, entries/quantomos puente y `vault/notebooks/{id}/`. Trinchera no se puede borrar.

## Layout canónico (slots vs páginas)

Interno: `slot_index` 0…159. Lo que el operador llama «página 8» es `numero_logico`, no el slot.

```text
slot 0          Tapa
slot 1          Página 1 (suelta, choca con la tapa)
slots 2–157     Páginas 2…79 en pares Izquierda / Derecha
slot 158        Página 80 (suelta, choca con la contratapa)
slot 159        Contratapa
```

Navegación del lector: **82 aperturas** (`spread` 0…81). Tapa, pág. 1, pág. 80 y contratapa son cara sola; el resto es doble página.

Etiquetas: `Página 8 · Izq`. En logs de servidor `slot 14` = `slot_index` 14 = Página 8 izquierda.

Las notas y planillas distinguen:

- `pág. 8` / `hoja 8` / `página 8` → `numero_logico = 8`
- `slot 14` → `slot_index = 14`

La tapa puede faltar (sin imagen): no pasa nada. Tapa y contratapa **nunca** se marcan vacías por heurística de tinta (suelen ser lisas).

## Estados de una página

```text
Vacia  →  PendienteVision  →  PendienteValidacion  →  Validada  →  Procesada
```

| Status | Significado |
| -------- | ------------- |
| `Vacia` | Sin contenido útil. Foto casi blanca (tinta &lt; 1,2 %) o el modelo dijo hoja en blanco **y** no hay tinta. |
| `PendienteVision` | Hay PNG; OCR en cola o falló (el error queda en `vision_meta.error`). |
| `PendienteValidacion` | OCR listo: título + transcripción espacial. Hay que leer y aprobar. |
| `Validada` | El operador aprobó. Listo para explicación IA y corpus. |
| `Procesada` | Ya hay `entry_id` + `quantomo_id` en el corpus. Guardar no baja el status. |

Índice del cuaderno (`index_json` / `index_status`):

- `vacio` — nada transcrito ni validado
- `parcial` — hay hojas con contenido, no todas en corpus
- `completo` — todas las hojas con imagen/texto están `Procesada`

## Fuentes

Tabla `notebook_sources`. Archivos en `vault/notebooks/{id}/sources/{sourceId}/`. Drop mixto o botón **Fuentes**. Hasta 32 archivos, 512 MB c/u. Estados: `queued` → `processing` → `ready` | `error`.

| Kind | Archivos | Qué hace |
| ------ | ---------- | ---------- |
| `pdf` | `.pdf` | Rasteriza (pdfjs, escala 1.5) a PNG, **un PDF page = un slot desde 0**. Máx. 160; el resto se trunca. Copia también `vault/notebooks/{id}/source.pdf`. |
| `image` | png/jpg/webp/heic/gif/tiff… | Convierte a PNG y **append** al siguiente slot sin imagen. |
| `audio` | m4a/mp3/ogg/wav/flac/aac | Deepgram STT **del cuaderno**, no de Trinchera. Transcript en `payload_json`. |
| `note` | textarea, `.txt`, `.md` | Si nombra páginas, va a `explanation_user`. Si no, `annex=true`. |
| `spreadsheet` | `.xlsx` `.xls` `.csv` | Overlay por fila: título y/o notas. |
| `json` | `.json` | Igual overlay (`pages` / `rows` / `items` o array). |

PDF e imagen **no** encolan OCR. Quedan `PendienteVision` + `pending_ocr` en el payload.

### Notas ancladas

Headers reconocidos (línea corta):

```text
pág. 12
página 3
hoja 7
slot 4
```

El texto debajo se concatena a `explanation_user` de esa hoja (separado de la explicación IA por `____________________`). Si no hay ninguna referencia, la nota es anexo de cuaderno y entra al contexto de *todas* las explicaciones.

### Planilla / JSON

Columnas (acentos irrelevantes): `slot` / `slot_index`; `page` / `pagina` / `hoja` / `numero_logico`; `title` / `titulo`; `notes` / `nota` / `explicacion`; `tags`. Hace falta slot **o** número de página, más título o notas. Si no matchea, queda anexo.

### Contexto extra al explicar

`collectNotebookExplainContext(notebookId, slot)` arma un bloque para Cohere:

1. Transcripts de audio del cuaderno (hasta 6k chars, enteros)
2. Notas anexo (hasta 3k)
3. Filas de planilla de **esa** hoja (hasta 2k)

No usa el audio de Trinchera.

## OCR / visión

`ocrNotebookPage()`:

1. Si `NOTEBOOK_OCR_BACKEND=unlimited` o `auto` **y** hay `UNLIMITED_OCR_URL`, llama al sidecar vLLM (Baidu Unlimited-OCR, modo `gundam`, una imagen por request).
2. Si falla o no hay sidecar, Cohere `command-a-vision-07-2025`.
3. `NOTEBOOK_OCR_BACKEND=cohere` saltea Unlimited.

Env (`.env.example`):

```text
COHERE_VISION_MODEL="command-a-vision-07-2025"
UNLIMITED_OCR_URL=
UNLIMITED_OCR_MODEL="baidu/Unlimited-OCR"
UNLIMITED_OCR_TIMEOUT_MS="1200000"
NOTEBOOK_OCR_BACKEND="auto"
```

Unlimited-OCR **no corre dentro de Node**: es un contenedor vLLM. Sin URL, todo va a Cohere.

La cola de visión es **serial** (una hoja a la vez) en memoria del proceso. Cuota Trial de Cohere (~1000 llamadas) **vacía la cola** y pide Production key.

Antes de mandar la foto, Cohere reescala a JPEG ~2048 px, calidad 86. Calidad 0–1 (p. ej. `0.84`) la librería la interpreta como ~1 y salen JPEGs de 5 KB ilegibles.

Salida esperada:

- `title`
- `transcription_spatial` (una línea del string = una línea visual)
- `graphic_elements` (tablas, formas, conectores; bbox 0–1)
- `is_blank`
- `meta`: layout `single` | `spread` | `cover`, `orientation_hint`, `page_bbox`, `spread.{left,right}_*`

Post-proceso:

- Si el modelo dice vacía pero hay tinta → no va a `Vacia`.
- Si el texto parece alucinación enciclopédica (p. ej. «segunda guerra mundial», «hoy hablaremos de») → segundo pase; si sigue, se descarta el texto.
- JSON truncado de Cohere: se **rescata** título y transcripción aunque el objeto no cierre. Sin eso la hoja queda vacía y no se puede aprobar.
- Layout `spread` en un slot Izq/Der: usa `left_*` / `right_*` de `meta.spread`.

## Lector y validación

El lector muestra la apertura actual, índice filtrable y lista de fuentes. Clic en la cara abre **Transcripción**.

Panel HITL (`PageValidationPanel`):

- Paneles: transcripción · explicación (operador / IA) · JSON de gráficos · entidades
- **Guardar** persiste; no aprueba
- **Aprobar transcripción** exige título o transcripción reales (no placeholders tipo «Hoja sin título», «tapa»)
- **Re-visión** reencola OCR de esa hoja
- Editor de imagen: rotar 90/180/270, crop; aplica `page_bbox` + `orientation_hint` si el modelo los dio
- **Separar spread**: recorta izq/der a los dos slots de esa apertura y reencola visión
- `@` en explicación busca personas / proyectos / agrupaciones; al mandar al corpus se taggean
- Poll cada 2 s mientras está `PendienteVision`; si el operador está editando (`dirty`), el poll **no pisa** título ni transcripción

Lienzo digital (`PUT .../canvas`): PNG 720×960, tools pen/line/rect/text/eraser. Opcional `run_vision`.

## Explicaciones y corpus

**Generar explicaciones** encola hojas `Validada`. Cohere escribe el bloque IA; el texto del operador se conserva arriba del separador `____________________`.

**Validar explicaciones** (HITL 1–12): vista dedicada imagen | texto editable. El operador corrige la explicación, elige peso hermético **1–12** y **Integrar** guarda + manda esa hoja al corpus (`explanation_weight` → `hermetic_weight` / `human_weight` del quántomo). Cola de todas las `Validada` con IA.

**Enviar al corpus** (lote o por hoja sin valorar):

1. Si no hay explicación IA, la genera
2. NER (`extractNotebookEntities`)
3. `entries.source_type = 'notebook_page'`, `status = 'approved'`, `title_manual = 1`
4. `quantomos`: `universe = 'cuaderno'`, peso = `explanation_weight` o **7**, `recognized = 1`
5. `content_raw` = transcripción + gráficos + explicación + @menciones
6. Propuestas de entidad + tags
7. Página → `Procesada`
8. Si es tapa, `cover_url` del cuaderno
9. Embed Mnemosyne (`embedApprovedEntry`)

El HITL de transcripción sigue siendo aprobar OCR; el de explicación es **Validar explicaciones**.

Botones de lote:

- Explicaciones: habilitado si hay `Validada` y **cero** `PendienteVision` (pueden quedar otras por validar; el backend solo encola `Validada`)
- Validar explicaciones: hay `Validada` con bloque IA (HITL hoja a hoja)
- **Validar todo**: da por válidas todas esas explicaciones e integra al corpus (peso 7 si faltaba)
- Corpus: además, **cero** `PendienteValidacion` y **todas** las `Validada` ya tienen explicación IA
- **Exportar**: siempre disponible → ZIP con imágenes, transcripciones, explicaciones, entidades y puente corpus

Por hoja (`PageValidationPanel`): **Validar explicación** abre la criba imagen|texto; **Enviar esta hoja al corpus** saltea la valoración (peso 7).

## Vault y DB

```text
vault/notebooks/{notebookId}/
  pages/{slot}.png          # cara canónica
  source.pdf                # último PDF ingerido (ruta legacy)
  sources/{sourceId}/{file}
```

Imagen servida: `GET /api/notebooks/:id/pages/:slot/image`.

Export ZIP (`GET /api/notebooks/:id/export`):

```text
manifest.json
pages/
  000_tapa/
    page.json               # título, status, transcripción, explicación,
                            # gráficos, menciones, corpus (entry/quantomo/NER)
    image.png               # si hay imagen en vault
  002_pagina_2_izq/
    ...
```

Solo incluye hojas con imagen o contenido. Nombre: `cuaderno-{slug}-{YYYY-MM-DD}.zip`.

Tablas: `notebooks`, `pages` (UNIQUE notebook+slot), `notebook_sources`. Puente al corpus: `pages.entry_id` / `pages.quantomo_id`.

`explained` dual: `explanation` (user + separador + IA), `explanation_user` (solo operador) y `explanation_weight` (1–12 tras Validar explicaciones).

## API (product notebooks)

Prefijo `/api/notebooks`. `kind=system` → 400 «Trinchera no es un cuaderno de biblioteca».

| Método | Ruta | Uso |
| -------- | ------ | ----- |
| GET | `/` | Lista fisico+digital |
| POST | `/` | `{ title, kind: fisico\|digital }` |
| GET | `/:id` | Notebook + pages + index + sources + summary + cola |
| PATCH | `/:id` | Renombrar / cover |
| DELETE | `/:id` | Borra vault + páginas + puente corpus |
| POST | `/:id/sources` | Multipart `files` + opcional `note` |
| POST | `/:id/sources/note` | `{ text }` |
| GET/DELETE | `/:id/sources` · `.../:sourceId` | Listar / quitar |
| POST | `/:id/ingest-pdf` · `ingest-images` | Legacy; la UI usa sources |
| POST | `/:id/process-ocr` · `full-read` | Encolar visión de pendientes |
| POST | `/:id/generate-explanations` | Explicar `Validada` |
| POST | `/:id/send-to-corpus` | Confirmar `Validada` |
| POST | `/:id/validate-all-explanations` | Dar por válidas todas las IA → corpus (peso 7) |
| GET | `/:id/export` | ZIP: `manifest.json` + `pages/{slot}/page.json` + `image.png` |
| GET | `/vision-queue` | Cola global |
| GET | `/:id/pages/:slot` | Página + label |
| PATCH | `/:id/pages/:slot` | Editar campos (`explanation`, `explanation_ai`, `explanation_weight`) |
| POST | `/:id/pages/:slot/approve-transcription` | → Validada |
| POST | `/:id/pages/:slot/reprocess-vision` | Re-OCR |
| POST | `/:id/pages/:slot/validate-explanation` | Peso 1–12 + texto → corpus |
| POST | `/:id/pages/:slot/confirm` | Una hoja al corpus |
| PUT | `/:id/pages/:slot/image` | Reemplazar PNG |
| POST | `/:id/pages/:slot/transform` | Rotar / crop |
| POST | `/:id/pages/:slot/split-spread` | Cortar doble página |
| PUT | `/:id/pages/:slot/canvas` | Lienzo digital |

Ingesta de imágenes API: `mode=append` (default) o `from_slot` + `start_slot` (sobrescribe consecutivos).

## Relación con el resto de Deprocast

- **Calendario**: páginas aún no mandadas al corpus (`entry_id` vacío, no `Vacia`) aparecen como ocurrencias `source_type=notebook_page`.
- **Personas / Proyectos**: @menciones + NER al confirmar → `entity_proposals` / `entity_links`.
- **Mnemosyne**: embed de la entry al pasar a `Procesada`.
- **Backup**: incluye `notebooks`, `pages`, `notebook_sources` y el vault.
- **Instagram / Trinchera**: OCR de frames de reels usa el mismo cliente Unlimited/Cohere; el STT de fuentes de cuaderno **no** entra a la criba de audio.

## Operación y trampas

- Arranque: Vite no debe proxyar `/api` hasta que Express escuche. `npm run dev` espera `/api/health` en `127.0.0.1:3001`. Un `ECONNREFUSED` al reiniciar con el lector abierto es esa carrera (o `localhost` IPv6 vs `127.0.0.1`).
- «Falta título o transcripción para aprobar»: OCR falló o el JSON se tiró. Re-visión; el salvage de JSON truncado debería dejar al menos el título.
- JPEG minúsculo en el log (`5 KB` a resolución alta): calidad mal pasada; hoy debe verse ~100–200 KB.
- Modelo inventa un tema que no está en la foto: detector de alucinación + segundo pase.
- Cuota Cohere Trial: la cola se detiene; las hojas quedan `PendienteVision` con el error en `vision_meta`.
- PDF largo: solo 160 caras. Fotos de más: en append se descartan las que no tienen slot libre.
- Poll vs textarea: si al escribir se borra el texto, es el poll de `PendienteVision` pisando el form; el flag dirty debería impedirlo tras Guardar/Re-visión/cambio de hoja.
- `Procesada` no baja de status salvo marcar vacía a mano.

## Receta mínima

1. Biblioteca → nombre → **+ Físico**.
2. Soltá el PDF o las fotos (o pegá una nota `pág. 1 …`).
3. **Procesar cuaderno** y dejá la cola.
4. Recorré aperturas, abrí Transcripción, corregí, **Aprobar**.
5. Cuando no queden pendientes de OCR: **Generar explicaciones** (aunque falten algunas por aprobar). Cuando el cuaderno esté validado y con IA: **Enviar al corpus**.
6. **Exportar** baja un ZIP con imágenes + JSON por hoja.
7. Las hojas aparecen en Validada / grafo / embeddings como el resto del corpus, con universo `cuaderno`.
