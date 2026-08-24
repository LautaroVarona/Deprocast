# El Cofre

```text
documento   : cofre.md
producto    : Deprocast
qué es      : Extensión Chrome MV3 de captura (pantalla + mic + STT live)
fecha       : 2026-08-24
carga       : dist-extension/ (unpacked)
server      : http://127.0.0.1:3001
```

El Cofre es el camino **live → vault → Aduana**. Directo sigue siendo bitácora en memoria. Esta extensión persiste.

Brújula de producto (qué hay, qué falta, hacia dónde): [`rumbo.md`](rumbo.md).

---

## 1. Por qué este orden

Chrome MV3 no deja `getUserMedia` ni `MediaRecorder` en el service worker. Tampoco crea el documento offscreen si no está declarado. Por eso:

1. `manifest.json` — permisos y piezas
2. service worker — orquesta, badge, timeline, upload
3. offscreen — captura + PCM al proxy Deepgram
4. `POST /api/ingest/cofre` — entry `pending_criba`

---

## 2. Arquitectura

```
Popup (gesto usuario)
  → chrome.desktopCapture / tabCapture
  → Service worker
       → Offscreen document
            → MediaRecorder (webm, timeslice 12s → IndexedDB)
            → AudioContext mix (pantalla + mic) → PCM linear16
            → ws://127.0.0.1:3001/api/live/stream (diarize=true)
       → chrome.tabs (URL, título, permanencia)
  → STOP
       → FormData audio + manifest
       → POST /api/ingest/cofre
       → vault/<id>/*.webm + cofre.json
       → entries.status = pending_criba
```

La API key de Deepgram **nunca** sale del server. El proxy ya existía para Directo (`server/liveWs.ts`).

---

## 3. Permisos (estrictos)

| Permiso | Para qué |
| --- | --- |
| `offscreen` | Documento invisible de captura |
| `desktopCapture` | Picker de pantalla / ventana / pestaña |
| `tabCapture` | Alternativa “solo pestaña activa” |
| `tabs` | URL, título y permanencia (no contenido de la página) |
| `storage` | Estado de sesión |
| `alarms` | Keep-alive del SW (~30 s) |
| host `127.0.0.1:3001` / `localhost:3001` | Health, config live, ingest, WebSocket |

No hay `content_scripts`. No hay `<all_urls>`. No hay captura de teclas ni de formularios.

---

## 4. Qué se guarda y qué no

Se guarda:

- video/audio webm de lo que el operador **elige compartir**
- transcript live (bloques finales + utterances con speaker si Deepgram diariza)
- timeline de pestañas http(s): URL, título, `at` / `until`

No se guarda:

- pulsaciones, valores de inputs, cookies, DOM de Idealista/Terreta
- páginas `chrome://`, `chrome-extension://`, `devtools://`

Biometría facial: fuera de esta entrega. El offscreen queda listo para `USER_MEDIA` más adelante.

---

## 5. Protocolo live (igual que Directo)

1. `GET http://127.0.0.1:3001/api/live/config`
2. `WS ws://127.0.0.1:3001/api/live/stream?model=&language=&sample_rate=16000&endpointing=300&diarize=true`
3. Frames binarios PCM 16-bit LE mono
4. KeepAlive JSON cada ~8 s: `{ "type": "KeepAlive" }`
5. Cierre: `{ "type": "CloseStream" }`

El proxy ahora envía `diarize=true` a Deepgram por defecto (`diarize=false` lo apaga). Directo lo hereda y no se rompe.

---

## 6. Ingest

`POST /api/ingest/cofre` (multipart, máx. 512 MB)

| Campo | Contenido |
| --- | --- |
| `audio` | webm |
| `manifest` | JSON: `started_at`, `ended_at`, `capture_mode`, `include_mic`, `mic_denied`, `final_blocks[]`, `utterances[]`, `tab_timeline[]` |

Efectos:

- `vault/<entryId>/<archivo>.webm`
- `vault/<entryId>/cofre.json` (telemetría completa)
- entry `source_type = audio`, `status = pending_criba` (**sin** pasar por STT batch)
- `content_raw` = transcript concatenado
- `diarization_json` / `speaker_map` seed
- `operator_note` = resumen (duración, pestañas, modo)
- `analyzeAudioSilence` en background para el player de criba

HITL 1–12 y extract no cambian. Protoquántomo = `quantomos.recognized = 0` en `pending_review`.

---

## 7. Cómo cargar (Chrome)

El server local tiene que estar arriba (`npm run server` o `npm run dev`).

```bash
npm run build:extension
```

1. chrome://extensions
2. Modo desarrollador
3. Cargar descomprimida → carpeta `dist-extension/`
4. Pin de El Cofre en la barra

Checklist:

- [ ] Popup muestra “Deprocast local en línea”
- [ ] Iniciar pantalla o “solo pestaña”; badge REC
- [ ] Cambiar de pestaña http(s) durante la grabación
- [ ] Detener y enviar
- [ ] En Deprocast, Aduana / criba: entry `Cofre YYYY-MM-DD HH:MM` con transcript
- [ ] `vault/<id>/cofre.json` existe

Si el upload falla, el blob sigue en IndexedDB: botón “Reintentar envío”.

---

## 8. Límites

- Chrome 116+ (offscreen `USER_MEDIA` / `DISPLAY_MEDIA` / `BLOBS`)
- Service worker efímero: la captura vive en offscreen; el SW solo orquesta
- Timeslice 12 s a IDB para no hinchar RAM en sesiones largas
- Video capado ~1080p / 15 fps / ~1.2 Mbps
- Bind del server: `127.0.0.1` (nada de red local)
- Primera vez: Chrome pide micrófono y el picker de pantalla
- Si el offscreen muere a mitad, el popup muestra error y hay que volver a grabar (los chunks a medias no se envían)

---

## 9. Archivos

| Pieza | Ruta |
| --- | --- |
| Manifest | `extension/manifest.json` |
| SW | `extension/sw.ts` |
| Offscreen | `extension/offscreen.ts` |
| Popup | `extension/popup.html` + `popup.ts` + `popup.css` |
| Ingest | `server/services/cofreIngest.ts` + `POST /api/ingest/cofre` |
| Build | `vite.extension.config.ts` → `dist-extension/` |
| Módulo catálogo | `src/lib/deprocast/modules.ts` id `cofre` |
