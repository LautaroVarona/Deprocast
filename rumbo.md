# Rumbo — Deprocast + El Cofre

```text
documento   : rumbo.md
producto    : Deprocast
qué es      : Brújula. Qué hay, qué falta, hacia dónde.
fecha       : 2026-08-24
después de  : arquitectura base de la extensión El Cofre (MV3)
leer con    : cofre.md · quantomos.md · v0.7.1.md · calendario.md
```

Este archivo no es un manual de carga ni un inventario de tablas. Es el mapa para volver a leer en frío y saber **dónde estás parado** y **qué decisión viene**.

La regla: separar **lo que el código hace hoy** de **lo que el mito del sistema pide**. Mezclarlos es cómo se pierde el rumbo.

---

## 0. Una frase

Deprocast es un organismo **local-first** que convierte vida grabada (voz, pantalla, chats, papel) en **átomos votados** (quántomos) y no deja que el LLM escriba memoria premium sin un humano en la Aduana.

El Cofre es la primera puerta que captura **mientras operás**, no después. Directo escucha. El Cofre guarda.

---

## 1. El tubo, sin poesía

```text
captura          →  vault + SQLite
                 →  Aduana HITL (voto 1–12)
                 →  extract (LLM)
                 →  protoquántomo
                 →  Campamento (reconocer, vincular)
                 →  Castillo (sello L72)
                 →  Corpus / Mastropiero / grafo
```

Tres escalas de calendario ya nombradas (`calendario.md`):

| Escala | Tecla | Tiempo | Trabajo |
|--------|--------|--------|---------|
| Trinchera | Alt+E | Día | Ingesta. Cofre. Voto. Deep work. |
| Campamento | Alt+W | Semana | NER, perfiles, anclas. Proto → pre. |
| Castillo | Alt+Q | Ciclo 28 | Sello. Corpus. Retrieve premium. |

El dato todavía **no obedece del todo** a esas tres escalas. Parte del código ya tiene `quantomos.stage` (`proto` / `pre` / `sealed`). Parte de las puertas (audio Aduana, WhatsApp, blobs) todavía puede nacer demasiado “listo”. `quantomos.md` es el contrato de hacia dónde hay que alinearlas.

---

## 2. Dónde está El Cofre en ese tubo

Hasta esta entrega había dos modos de meter audio:

1. **Zona franca** — archivo `.m4a` / `.mp3` / `.ogg` → `queued` → pipeline STT batch → `pending_criba`.
2. **Directo** — micrófono → proxy Deepgram live → bloques **en RAM**. Al recargar, se pierde.

El Cofre es el tercero:

3. **Extensión MV3** — pantalla o pestaña + mic + STT live + timeline de URLs → al detener, `POST /api/ingest/cofre` → entry `audio` en **`pending_criba`** **sin** re-pagar STT batch.

```text
Zona franca     archivo muerto     (después)
Directo         oído vivo          (ahora, amnésico)
El Cofre        sesión viva        (ahora, con vault)
```

No reemplaza Aduana. La alimenta. El voto 1–12 sigue siendo el mismo gesto. El extract sigue siendo el mismo. El protoquántomo sigue naciendo **después** del peso humano, no antes.

Detalle de permisos, protocolo WS y cómo cargar unpacked: [`cofre.md`](cofre.md).

---

## 3. Qué es real hoy (código)

### Captura

| Puerta | Estado | Persistencia | HITL |
|--------|--------|--------------|------|
| Zona franca (audio) | Operativa | Vault + `queued` | Criba 1–12 |
| Blobs / notas | Operativa | Entry texto | Distinto (no criba de audio) |
| Bookmarks Twitter/IG | Operativa | Criba de bookmarks | Scoring + process |
| Cuadernos / OCR | Operativa | Páginas | Validación de hoja |
| Chats WhatsApp import | Operativa | Destilado | Históricamente débil en voto |
| Directo (live mic) | Operativa | **Ninguna** | No |
| **El Cofre (extensión)** | **Base MV3 lista, no verificada en runtime aquí** | Vault + `pending_criba` | **Sí, la criba de audio** |
| Diálogo → Terminar + voto | Diseñado en `quantomos.md` | A confirmar en UI | Debería |

### Kernel de audio (el que El Cofre usa)

```
pending_criba  →  voto 1–12  →  pending_extract
               →  Cohere extract  →  pending_review
               →  approve  →  quántomos (idealmente stage=proto)
```

El Cofre **salta** `queued` y el STT batch. Llega con `content_raw` + `diarization_json` + `cofre.json` (telemetría de pestañas). El análisis de silencios corre en background para el player.

### Memoria y retrieve

- SQLite local + vault en disco. Bind `127.0.0.1`.
- Embeddings / Mnemosyne: cableados en la transición 0.7.
- L72 + HMAC: servicio (`lattice72.ts`, `quantomoStages.ts`). El Castillo no es aún el único camino a `recognized = 1`.
- Respaldo ZIP/JSON: [`respaldo.md`](respaldo.md). El código va por git; `data/` y `vault/` no.

### El Cofre, pieza por pieza

| Pieza | Hay | Verificado en Chrome |
|-------|-----|----------------------|
| `manifest.json` MV3, permisos estrictos | Sí | No (falta load unpacked) |
| Popup: health, pantalla, pestaña, stop, retry | Sí | No |
| Offscreen: mix mic+display, MediaRecorder, IDB | Sí | No |
| Proxy live + `diarize=true` | Sí (server) | Parcial (Directo sí usa el proxy) |
| Timeline `chrome.tabs` (URL / título / permanencia) | Sí | No |
| `POST /api/ingest/cofre` | Sí | No (Node del entorno de build era v20; el server pide ≥22.5) |
| Content scripts / keylogger | **No. A propósito.** | — |
| Biometría / webcam | **No. A propósito.** | — |

---

## 4. Qué es visión (aún no es el kernel)

Estas frases son **norte**, no inventario:

- Joaquín K. Galturn / Mastropiero / el Atanor: marco de operador. El código no implementa personajes; implementa puertas.
- “Programar la propia realidad”: el producto es un **embudo de memoria**, no un simulador.
- Quántomo L72 sellado como única semilla RAG: el diseño está en `quantomos.md`. Hoy todavía hay caminos que marcan `recognized = 1` demasiado pronto.
- El Cofre como “data premium” de toda la jornada (Idealista, Terreta, escritorio, voz): la extensión **puede** grabar la sesión; **no** espiar el DOM. La telemetría es de pestaña, no de formulario.
- Diarización de voces en live: el proxy ya pide `diarize`; hay que ver en Aduana si los speakers llegan utilizables. Si no, la criba humana sigue siendo la verdad.
- Overlay LED in-page: no está. El badge REC + popup alcanzan para v1.

Si una idea no puede bajar a una entry, un voto y un protoquántomo, todavía no es producto.

---

## 5. Decisiones que ya están tomadas (no reabrir)

1. **Manifest primero.** Sin declaración no hay offscreen ni captura. El WS se arma *después*.
2. **API key de Deepgram solo en el server.** La extensión habla con `127.0.0.1:3001`, igual que Directo.
3. **No hay keylogger.** Ni “patrones de escritura”, ni valores de inputs, ni `<all_urls>`. Aunque sea “para vos”.
4. **No re-STT** un Cofre de una hora. El live transcript entra a criba. Si un día la calidad no alcanza, un flag `retranscribe` es un extra, no el default.
5. **`source_type = audio`.** Así la criba existente lista el Cofre sin un pipeline paralelo.
6. **HITL 1–12 no se toca.** El Cofre no auto-vota. No nace quántomo premium al detener la grabación.
7. **Localhost only.** El server no es un servicio en la LAN. La extensión no es un SaaS.

---

## 6. Huecos (lo que va a doler si no se nombra)

### El Cofre (corto plazo)

- Load unpacked en Chrome 116+ y el checklist de `cofre.md`. Hasta que no pase, es arquitectura, no herramienta.
- Primera vez: permiso de mic + picker de pantalla. Si Chrome bloquea `getUserMedia` en offscreen, hay que un unbox visible (pestaña de opciones) — riesgo conocido de MV3.
- Mezcla mic + audio de pestaña: a veces el desktop stream no trae audio. El código cae a video-only + mic; hay que oír una sesión real.
- Sesiones largas: timeslice 12 s y tope 512 MB. Una tarde entera puede partirse en varios Cofres o subir el bitrate mal.
- Si el offscreen muere, no hay recover de chunks a medias. Retry solo cubre **upload** fallido con IDB completo.
- Telemetría: URLs con query pueden traer tokens. Se guardan. Conviene más adelante strip de query en sitios de login.
- Directo y Cofre no se ven. No hay “sesión Cofre activa” en la Trinchera. Dos oídos que no se conocen.

### Embudo quántomo (medio plazo)

- Unificar **todas** las puertas a `stage = proto` + voto. WhatsApp y blobs no pueden saltarse la Aduana si el Corpus va a ser sagrado.
- Campamento: cola semanal de protoquántomos. Hoy el extract tira entidades; el humano aún no tiene un “campamento” como estación obligatoria.
- Castillo: sello L72 como único `recognized = 1`. Hasta que eso sea cierto, Mastropiero puede beber agua sucia.
- Diálogo “Terminar → peso → destilar”: el relato está; hay que verificar que el botón existe y cierra el hilo de verdad.

### Operación

- Node ≥ 22.5 en **todas** las máquinas (sqlite nativo). v20 no arranca el server.
- Respaldo: cada Cofre es webm potencialmente grande. El ZIP “con media” va a doler. Política: Cofres del día en USB, no en cada fusión.
- Deepgram live vs batch: costos distintos. Live ya se pagó; no duplicar.

---

## 7. Hacia dónde (tres horizontes)

### Horizonte A — que El Cofre exista de verdad

Objetivo: una jornada de trabajo termina en Aduana, no en un recuerdito.

1. Cargar `dist-extension/` en Chrome.
2. Grabar 3–5 minutos (pantalla + mic), cambiar de pestaña, detener.
3. Ver la entry en criba con transcript, speakers seed, `cofre.json`.
4. Votar 1–12. Confirmar que sale extract y protoquántomos.
5. Anotar qué falló (audio de pestaña mudo, diarize vacío, upload, offscreen).

Hasta que A no esté verde, no se diseña la biometría ni los sensores de Idealista.

### Horizonte B — un solo Cofre conceptual

Hoy “Cofre” en `quantomos.md` es la **bandeja de Trinchera** (hilos, WhatsApp, audio, blobs). La extensión es **una puerta** de esa bandeja.

El movimiento correcto:

- La extensión deposita.
- La UI Trinchera (Alt+E) **lista** lo depositado hoy: Cofres, Directo-si-alguna-vez-guarda, audios franca, hilos cerrados.
- Un solo gesto de voto por ítem. No un HITL distinto por fuente.

Directo, más adelante, puede ser el monitor mientras El Cofre graba — o morir como producto y quedar como debug del proxy.

### Horizonte C — materia que madura

Cuando las puertas nacen proto:

- Trinchera = ingesta + voto.
- Campamento = reconocer mundo (personas, proyectos, tiempo).
- Castillo = sello. Ahí sí RAG, ahí sí Mastropiero, ahí sí “data premium”.

L72 no es decoración: es identidad del átomo. Mnemosyne sigue siendo semántica continua. Los dos se necesitan; ninguno sustituye el voto.

Biometría / webcam / overlay en página: **después** de C, o nunca, si no aportan a un quántomo. El offscreen ya es el único sitio seguro para un feed de cámara.

---

## 8. Mapa de módulos (lectura rápida)

Los que importan para este rumbo, según [`src/lib/deprocast/modules.ts`](src/lib/deprocast/modules.ts):

| id | Rol en el tubo |
|----|----------------|
| `franca` | Archivos muertos → cola |
| `directo` | Oído vivo, sin DB |
| **`cofre`** | Sesión viva → `pending_criba` |
| `pipeline` | STT batch + extract |
| `aduana` | Peso, speakers, approve |
| `criba` | Bookmarks, otro HITL |
| `chats` | Import destilado (alinear a proto) |
| `dialogo` | RAG; debe desembocar en Cofre/voto |
| `biblioteca` | Papel → OCR → proto |
| `calendario` | Trinchera / Campamento / Castillo como **tiempo**, no como otra DB |

IDA (`IDA.md`) es el organismo mirándose: no es la Aduana. No mezclar backlog de producto con destilado hermético.

---

## 9. Cómo usar este archivo

Cuando vuelvas:

1. Si vas a **grabar**, leé [`cofre.md`](cofre.md) (carga, permisos, checklist).
2. Si vas a **cambiar el embudo de quántomos**, leé [`quantomos.md`](quantomos.md) y preguntate: ¿esta puerta nace proto? ¿quién vota?
3. Si vas a **meter sensores en la web**, volvé a la sección 5. La respuesta por defecto es no.
4. Si el mito (Galturn, Atanor, Mastropiero) empieza a dictar features: bajarlo a entry + voto + proto, o no existe.

El Cofre no es la antología. Es el artefacto que hace que la jornada deje huella en el vault **antes** de que la Aduana la transmuta. El resto —Campamento, Castillo, Corpus— solo tiene sentido si esa huella es votada y no automática.

---

## 10. Estado al 2026-08-24

```text
kernel audio HITL     : [OK]
Directo live          : [OK] en memoria
El Cofre código       : [OK] base MV3 + ingest
El Cofre en Chrome    : [PENDIENTE] load unpacked + sesión real
Puertas → proto       : [PARCIAL] diseño sí, todas las fuentes no
Campamento obligatorio: [UX-GAP]
Castillo = único sello: [PARCIAL]
```

Siguiente movimiento concreto: **Horizonte A**. Una grabación real. Una entry en criba. Un voto. Recién ahí se discute la siguiente pieza.
