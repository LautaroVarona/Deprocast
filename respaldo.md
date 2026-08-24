# Respaldo

```text
documento   : respaldo.md
producto    : Deprocast
qué es      : Inventario del sistema de copia / fusión / restore
fecha       : 2026-08-23
formato     : deprocast-backup v3
```

Informe del universo portable: qué se guarda, en qué formato, cómo llevar trabajo de una notebook a la oficina **sin borrar** el universo destino, y qué quedó fuera.

El código viaja por git. Los datos no: `data/` y `vault/` están en `.gitignore`.

---

## 1. Qué hay que hacer mañana (oficina)

Esta notebook tiene trabajo nuevo (audios, un cuaderno, IDA, entidades). La oficina tiene **más** corpus. No uses Reemplazar ni NUEVO USUARIO.

1. Acá: Respaldo → **ZIP (con media)**. Si el ZIP es enorme para el browser, JSON + copiá la carpeta `vault/` a un USB.
2. Oficina: `git pull` de estos cambios, arrancar la app.
3. Respaldo → **Fusionar**. Escribí `FUSIONAR`. Subí el ZIP (o el JSON).
4. Si subiste solo JSON: pegá los archivos nuevos de `vault/` sobre `vault/` de la oficina. No borres lo que ya está.
5. Recarga. Revisá IDA, entidades, el cuaderno y un audio.

La fusión **suma** filas con id nuevo. No pisa la RUN, AmazonA, ni las fichas IDA seed de la oficina.

---

## 2. Formato

Identidad: `format = "deprocast-backup"`. Versión actual de export: **3**. Restore y fusión aceptan **1, 2 y 3**.

| Campo | Contenido |
| --- | --- |
| `purpose` | `copy` (seguir jugando) o `metanalisis` (cierre de RUN / NUEVO USUARIO) |
| `exported_at` | ISO de la exportación |
| `include_media` | `true` solo en el `dump.json` dentro del ZIP |
| `run` | operador, fechas, día de RUN |
| `vault_index` | paths + size + mtime relativos a `vault/` (no los bytes) |
| `tables` | `SELECT *` de cada tabla de `BACKUP_TABLES` |

### Archivos que genera la UI

| Formato | Restaurable | Media | Uso |
| --- | --- | --- | --- |
| **JSON** | Sí | No (índice sí) | Copia liviana / fusión de SQLite |
| **ZIP** | Sí (`dump.json` + `vault/` + `feedback/`) | Sí | Traslado entre PCs |
| CSV | No | No | Planilla / lectura |
| XML | No | No | Lectura |

Nombre tipo: `deprocast-respaldo-{operador}-{YYYY-MM-DD}.{ext}`.

NUEVO USUARIO además escribe `data/respaldos/deprocast-{operador}-{inicio}-{fin}.json` **antes** de borrar actividad.

No hay dump `.sql` nativo. El ZIP no usa ZIP64: si un archivo supera ~4 GB, exportá JSON y copiá `vault/` a mano.

---

## 3. Qué se respalda (SQLite)

Fuente: `data/deprocast.db`. Lista en `server/services/backup.ts` → `BACKUP_TABLES`.

### Corpus

`notebooks`, `entries`, `quantomos`, `pending_tasks`, `validated_file_metadata`, `pages`, `notebook_sources`, `embeddings`

Incluye transcripciones, diarización, análisis de audio, OCR de páginas, paths a media (`vault_path`, `image_path`).

### Entidades y grafo

`persons`, `projects`, `entity_aliases`, `project_aliases`, `entry_entities_raw`, `entity_proposals`, `entity_links`, `person_relations`, `person_project_links`, `graph_link_dismissals`, `agrupaciones`, `agrupacion_members`, `dominios`, `geografia`

Las **vinculaciones** persona↔persona y persona↔proyecto van en el JSON.

### Criba / chats / diálogo

`bookmarks`, `chat_sessions`, `chat_messages`, `chat_blocks`, `dialogo_threads`, `dialogo_messages`, `dashboard_pins`, `link_harvest`

### Sandbox, feedback, RUN

`sandbox_graphs`, `sandbox_nodes`, `sandbox_links`, `feedback_notes`, `app_runs`

### AmazonA y mapa

`ama_lists`, `ama_list_items`, `ama_lista6_parts`, `ama_places`, `ama_matrices`, `ama_cells`, `ama_neo_cells`, `ama_flows`, `ama_links`, `ama_cycle_state`, `map_systems`, `map_layers`, `map_tags`

### IDA (núcleo Deprocast)

IDA **sí entra** en el respaldo completo. No hay que exportar Academia aparte para migrar.

| Tabla | Qué es |
| --- | --- |
| `depro_ida_items` | Fichas. Investigaciones = `stage = 'investigacion'`. Kind `organismo` o `aprendizaje`. Peso, celda 6×6, poderes, agentes, dominios. |
| `depro_ida_cards` | Flashcards de Academia (`due_at`, `ease`) |
| `depro_research_packs` | Packs de Cuarentena (prompt Perplexity) |
| `depro_research_findings` | Hallazgos; `assimilated_ida_id` si bajaron a ficha |
| `depro_power_notes` | Overlay de Matrix 72 |
| `embeddings` | Vectores, incluido `object_type = 'ida_item'` |

Las 11 fichas seed (`depro-ida-omnivoro`, `depro-ida-auto-peso`, …) tienen **id fijo**. Las investigaciones nuevas tienen UUID. En fusión: seeds se saltan; fichas nuevas entran.

El markdown de Academia (`GET /api/deprocast/ida/export`) **no** es un respaldo: solo aprendizajes, sin organismo, cards ni research, y no se puede restaurar.

---

## 4. Qué no entra

| Dato | Dónde vive | JSON | ZIP |
| --- | --- | --- | --- |
| Audios, enhanced, parts | `vault/{entryId}/` | índice | archivos |
| PNG / PDF de cuadernos | `vault/notebooks/` | índice | archivos |
| Exports `.txt` de chats | `vault/chats/` | índice | archivos |
| Media Instagram local | `vault/…` | índice | archivos |
| Adjuntos de feedback | `feedback/` | filas `feedback_notes` | archivos |
| FTS (`persons_fts`, etc.) | SQLite virtual | no | no (se reconstruye) |
| `.env` / API keys | raíz | no | no |
| Preferencias de UI | `localStorage` | no | no |
| Catálogo Matrix 72 / agentes | código | no (salvo overlays) | no |
| Sesión live Deepgram | memoria | no | no |

Tras fusionar solo JSON, las filas apuntan a `vault_path` que puede no existir en destino: se ven transcripts, no se oye el audio ni se ven fotos hasta copiar media.

---

## 5. Tres operaciones (no las mezcles)

### Fusionar — `POST /api/backup/merge`

Para **esta notebook → oficina**.

- No borra nada.
- `INSERT OR IGNORE` por clave primaria / UNIQUE.
- Remapea Trinchera: el id del cuaderno sistema **no es fijo** (`randomUUID` al seed). Si el dump trae otra Trinchera, se reescribe `notebooks.id` / `entries.notebook_id` / `pages.notebook_id` / `notebook_sources.notebook_id` al id local. Los audios caen en la Trinchera de destino, no en un segundo cuaderno sistema.
- `app_runs` con `status = current` entran como `imported`. La RUN de la oficina sigue.
- Personas operador del dump entran con `is_operator = 0` (si el id ya existía, se ignora y la oficina conserva el suyo).
- Media del ZIP: se copia a `vault/` y `feedback/` **solo si el archivo no existe**.
- Después: `rebuildSearchFts`, `ensureTrincheraSeed`.
- Respuesta: `inserted` / `skipped` por tabla, remap de Trinchera, stats de media.

### Reemplazar — `POST /api/backup/restore`

Borra **todas** las `BACKUP_TABLES` y deja las del archivo. En la oficina destruye el universo grande. Confirmación `REEMPLAZAR`.

### NUEVO USUARIO — `POST /api/run/new-user`

Metanálisis a disco + wipe de `USER_ACTIVITY_TABLES`. **Conserva** IDA, AmazonA, mapa, dominios. No sirve para migrar entre PCs: borra el corpus de la RUN.

---

## 6. Limitaciones de la fusión

- Misma persona o proyecto creado a mano en las dos máquinas (ids distintos) → **dos filas**. No hay match por nombre.
- Edits a un seed IDA (`depro-ida-*`) en esta notebook **no** pisan la oficina.
- `dashboard_pins` (PK = slot) y `depro_power_notes` (PK = `power_index`): gana lo que ya está en destino.
- Celdas AmazonA con UNIQUE `(matrix_id, row, col)`: igual, gana destino.
- JSON viejo (v1/v2) fusiona igual; no trae bytes de media.

---

## 7. API

| Método | Ruta | Qué |
| --- | --- | --- |
| GET | `/api/backup/summary` | Conteos, grupo IDA, `vault_bytes` / `vault_files` |
| GET | `/api/backup?format=json\|csv\|xml\|zip` | Descarga |
| POST | `/api/backup/merge` | Fusionar JSON o ZIP (multer a disco, hasta 8 GB) |
| POST | `/api/backup/restore` | Reemplazar JSON o ZIP |

UI: `src/components/RespaldoSection.tsx`. Motor: `server/services/backup.ts`. ZIP: `server/services/backupZip.ts`.

---

## 8. Inventario rápido

| Superficie | ¿En el respaldo completo? |
| --- | --- |
| Investigaciones IDA, cards, Cuarentena | Sí (tablas) |
| Entidades y vinculaciones | Sí |
| Entries / quántomos / validaciones | Sí |
| Cuadernos (filas + OCR) | Sí; PNG en ZIP |
| Audios | Solo ZIP o copia de `vault/` |
| AmazonA / mapa | Sí; fusión no los pisa si el id coincide |
| Export markdown Academia | No es restore |
| Export ZIP de un cuaderno (Biblioteca) | Parcial, por notebook; no reemplaza esto |

---

## 9. Cambio del 2026-08-23

Antes el import era solo reemplazo total y el JSON no llevaba media. IDA ya estaba en las tablas; el hueco era operativo: no se podía **sumar** este universo al de la oficina ni llevar audios/fotos.

Ahora: formato v3, fusión aditiva, ZIP con `dump.json` + vault + feedback, contador IDA visible, y este documento.
