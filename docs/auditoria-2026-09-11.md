# Auditoría Deprocast 0.7.1 — 11 de septiembre 2026

```text
documento   : docs/auditoria-2026-09-11.md
producto    : Deprocast 0.7.1 local (repo LautaroVarona/Deprocast)
qué es      : Mapa real de producto + huecos docs vs código + deuda que traba el uso diario
midió       : código en este repo (src/, server/, shared/, extension/, tests/)
no midió    : runtime Chrome de El Cofre, corpus vivo en C:\Users\Lautaro.Sarni\dev\deprocast
fecha       : 2026-09-11
después de  : reporteseptiembre4.md · auditoria2608.md · rumbo.md · v0.7.1.md
```

Este informe es para que Lautaro sepa **qué hay hoy**, **qué docs mienten** y **qué conviene shippear hoy**. No reescribe la filosofía. No inventa ejes AmazonA. Hexágono 0.7 se toma como verdad de producto: 0.7.1 es código+uso; 0.7.2–0.7.5 son instancias de entrenamiento hacia 1.0; 0.7.1 sigue siendo el disco de verdad.

Las etiquetas **hecho** / **hipótesis** importan. Hecho = leído en código. Hipótesis = plausible, no ejecutado contra tu DB local.

---

## 0. Qué es 0.7.1, en una frase

Un organismo **local-first** (SQLite `data/deprocast.db` + `vault/`, bind `127.0.0.1`, token local) que convierte captura votada en **quántomos** (`proto` → `pre` → `sealed`). El Corpus RAG / Diálogo / Mnemosyne solo bebe `recognized=1` **y** `stage=sealed`. El sello L72 (`sealQuantomo`) es el único escritor de `recognized=1` en runtime.

Prioridad de dueño (no de superficie): **corpus personal, HITL, creación de quántomos**. El Cofre MV3 se va a retirar; no es núcleo. Las puertas de captura (Directo, bookmarks, extensión) son laterales.

Hecho de dueño, no de código: el 9 de septiembre sellaste por voto **fuera de la app** un export (cuaderno rojo + ~680 proto). El flip `recognized=1` **no** se hizo en la app. Eso encaja con lo que el código permite hoy: hay export por etapa; **no había** import de voto → sello.

---

## 1. Mapa real de producto

### 1.1 Navegación

No hay React Router para el nav principal. `src/App.tsx` guarda `useState<AppView>`. Refresh cae siempre en `dashboard`, salvo pathname `/deprocast*`.

| Pieza | Dónde | Hecho |
| --- | --- | --- |
| Tipo de vista (21 ids) | `src/components/BrandNav.tsx` | `dashboard`, `franca`, `directo`, `aduana`, `validada`, `entidades`, `quantomos`, `grafo`, `criba`, `biblioteca`, `conocimiento`, `chats`, `dialogo`, `sentinela`, `respaldo`, `configuracion`, `calendario`, `amazona`, `mapa`, `atlas`, `aleph` |
| Mega-menú | BrandNav, 6 grupos | Inicio · Captura · Archivo · Figuras · Espacio · Sistema |
| Switcher | `src/App.tsx` ~297–409 | `franca` no tiene rama propia: cae al `else` → `FreeZone`. Funciona. |
| Auto-Aduana | `checkPending` cada 5 s | Salta a Aduana si hay criba/review **y** `stayHome=false`. Casi todos los ítems de nav van con `stayHome: true`; Aduana es la excepción. |
| Núcleo | pathname `/deprocast`, `/agentes`, `/ida` | App aparte (`DeprocastApp`). Finanzas / Derecho / Vitalidad están marcados ausentes en el catálogo, no son vistas. |

Deep links: solo Núcleo. El resto no tiene URL.

### 1.2 Superficie por grupo (lo que el operador ve)

**Inicio**

- **Dashboard** — typeahead, pines, atajos a Diálogo / Entidades / Quántomos / Calendario / Respaldo.
- **Diálogo** — Oráculo RAG. **Terminar** pide peso 1–12 y nace proto (`closeDialogoThread` → `quantomoStages.ts`). Vacío: “Elegí un hilo”.
- **Sentinela** — perfil / chat / skills / log. Vacío: “Creá una sentinela”.

**Captura (puertas)**

| Puerta | Vista | Persistencia | HITL |
| --- | --- | --- | --- |
| Zona franca | `franca` → `FreeZone` | vault + `queued` | Criba audio 1–12 |
| Directo | `directo` | **RAM**; se pierde al recargar | No. El copy manda a El Cofre. |
| El Cofre | extensión MV3, no vista | `POST /api/ingest/cofre` → `pending_criba` sin re-STT | Sí, misma criba |
| Aduana | `aduana` → `CustomsPanel` | — | Criba + Validación |
| Criba bookmarks | `criba` | X / IG | Voto 1–12 por banda |
| Chats import | `chats` | destilado proto | Históricamente débil |
| Biblioteca | `biblioteca` | OCR de hoja | Validación de página; el átomo nace `stage=pre` (salta proto) |
| Conocimiento | `conocimiento` | repos GitHub | Voto 1–12 |

**Archivo**

- **Validada** — entries `approved` + export JSON delgado (sin `recognized` / `stage`).
- **Quántomos** — Corpus. Filtro por defecto **`sealed`**. Export client-side incompleto vs dump de Respaldo.

**Figuras**

- **Entidades** — hub: sala / perfiles / agrupaciones / geografía / dominios / proyectos. NER HITL.
- **AmazonA** — campo / listas / geo / ciclo. No se auditó como eje nuevo; no se toca.

**Espacio**

- **Calendario** — las tres escalas **no** son rutas top-level. Viven dentro de `calendario` (`Alt+E` Trinchera, `Alt+W` Campamento, `Alt+Q` Castillo).
- Atlas / Aleph / Grafo / Mapa — laterales al tubo de corpus.

**Sistema**

- Respaldo (JSON/ZIP/CSV/XML + dump por etapa de quántomos). Fusionar / Reemplazar / NUEVO USUARIO.
- Config (token local, jobs, LLM).
- Núcleo `/deprocast`.

### 1.3 Castillo / Trinchera / Campamento (hecho)

No son módulos sueltos en BrandNav. Son dimensiones de `CalendarioSection`:

| Dimensión | Componente | Trabajo de dato |
| --- | --- | --- |
| Trinchera | `TrincheraView` + `CofrePanel` | Ingesta del día. El panel Cofre muestra **conteos** (hilos, proto, pre, sellados). “Terminar está en Diálogo.” |
| Campamento | `CampamentoView` + `CampamentoQueue` | Proto → pre (`POST /api/quantomos/:id/promote-pre`). |
| Castillo | `CastilloView` + `CastilloSealPanel` | Pre → sello (`POST /api/quantomos/:id/seal`). |

Hasta este PR las colas de Campamento/Castillo **recortaban a 8 ítems** (`slice(0, 8)`). Con ~680 proto eso explica, a nivel de UI, por qué el sello masivo se hizo fuera de la app.

### 1.4 Directo / Validación / Entidades

- **Directo**: STT live (`LiveSessionProvider`). Cero DB. No es puerta de corpus.
- **Validación** no es una vista. Es:
  - tab **Validación** de Aduana (`pending_review`);
  - Criba de audio (peso 1–12);
  - validador NER en Entidades;
  - paneles de hoja/explicación en Biblioteca;
  - colas proto/pre en Calendario.
- **Entidades**: `EntityHub` con 6 modos. `PersonsSection` standalone (`embedded=false`) no se importa en ningún lado — camino UI muerto.

### 1.5 Kernel: entries y quántomos

Estados de `entries.status` (**hecho**, `server/types.ts`):

```text
queued → processing → pending_criba → (voto 1–12) → pending_extract
       → processing → pending_review → approved | rejected
split_parent (audio largo) → hijos queued
error → queued (retry)
```

Solo `queued` y `pending_extract` se drenan solos (`pipelineQueue.ts`). `pending_criba` espera humano.

Audio feliz (hecho):

```text
ingesta → vault + queued
Fase A STT → pending_criba
Aduana Criba voto 1–12 → pending_extract
Fase B Cohere → pending_review + proto (recognized=0)
Aduana Validación Aprobar → entry approved, quántomos **siguen proto / recognized=0**
Campamento promoteToPre → pre / recognized=0 + NER proposals
Castillo sealQuantomo → sealed / recognized=1 + lattice L72 + embed
```

“Aduana HITL 1–12” **no** son doce estaciones. Es la **escala de peso** (teclas 1–9, 0/q=10, '/w=11, Enter/e=12). El tope de átomos extraídos es `maxQuantomosForWeight` (1–3 → 1 átomo … 12 → 6). Peso ≤ 3 = modo slop.

**Único writer de `recognized=1` en runtime:** `sealQuantomo` en `server/services/quantomoStages.ts`. Approve de Aduana pone `recognized=0, stage=proto` a propósito (`server/routes/proposals.ts`). RAG: `shared/oracleRag.ts` → `recognized === 1 && stage === 'sealed'`.

Otras puertas al nacer (hecho):

| Puerta | status entry | stage al nacer |
| --- | --- | --- |
| Audio / Cofre | queued / pending_criba | proto en extract |
| Chat import | approved | proto |
| Diálogo Terminar | approved | proto |
| Blob / nota | approved | proto |
| Bookmark | approved | proto |
| Hoja de cuaderno | approved | **`pre`** (salta proto) |
| Convert L72 de cuaderno | approved | proto → pre → sealed automático |

### 1.6 Disco de verdad y “bus JSON”

| Sitio | Qué |
| --- | --- |
| `data/deprocast.db` | SQLite WAL |
| `data/local-token` | token si no hay `LOCAL_API_TOKEN` |
| `vault/{entryId}/` | audio, `cofre.json`, enhanced |
| `vault/notebooks/`, `vault/instagram/` | papel / reels |
| Dump por etapa | `GET /api/backup/quantomos?stage=proto\|pre\|sealed` formato `deprocast-quantomos` v1 |

**No hay bus de mensajes entre instancias.** El contrato compartido hoy es el JSON de etapa (`quantomoExport.ts`) + `shared/oracleRag.ts`. 0.7.1 permanece disco de verdad; un bus entre 0.7.2–0.7.5 es horizonte, no código.

### 1.7 Bind y token (hecho)

- Server: `app.listen(PORT, '127.0.0.1')`.
- Token: env o `data/local-token` (0600). Header `X-Deprocast-Token` / Bearer / `?token=` / cookie.
- Vite inyecta el header en `/api`. Health es público. Mutaciones sin Origin ni token → 401.
- CORS: 5173 / 3001 / `chrome-extension://`.
- Extensión: origin fijo `http://127.0.0.1:3001`.

Esto **no** es un bug de producto; es el contrato local-first. Duele si el browser pide `localhost` vs `127.0.0.1`, o si Vite y el server no comparten el mismo `data/local-token`.

---

## 2. Docs vs código

Escala: **fiel** / **viejo** / **mito**. “Viejo” = fue verdad en 0.6 o en agosto y el código ya se movió.

| Doc | Estado | Qué falló |
| --- | --- | --- |
| `README.md` | **Fiel** como setup | No lista el tubo proto/pre/sealed ni las 21 vistas. Suficiente para arrancar. Versión npm sigue `0.1.0`. |
| `reporteseptiembre4.md` | **El más fiel** hasta hoy | Mapa de puertas y capas aguanta. Oleada A/B/C (híbrido, citas, F1 audio) está en código. No cubre el sello masivo ni el voto del 9 Sep. |
| `auditoria2608.md` | **Fiel como cierre de endurecimiento** | Token, paths, restore staging, CI: siguen. No es mapa de producto 0.7.1. |
| `rumbo.md` | **Brújula, parcialmente mito** | Fecha 24 ago. Sigue diciendo que Castillo **no** es el único `recognized=1` y que hay caminos que marcan 1 demasiado pronto. En runtime **ya no**: solo `sealQuantomo` (+ backfill de migración). Horizonte A (Cofre en Chrome) sigue pendiente de verificación aquí. Campamento “obligatorio” ya tiene UI, pero recortada. |
| `v0.7.1.md` | **Archivo 0.6, no 0.7.1** | Fecha 5 ago. Superficie `franca \| aduana \| validada`. Approve → `recognized=1`. Entidades “no persisten”. CRM “no llamado”. Embeddings “no encolados”. Máquina de estados sin `pending_criba`. Castillo/Campamento como UX-GAP. **No usar para operar.** |
| `quantomos.md` | **Contrato de tubo, con dos mentiras puntuales** | El tubo proto/pre/sealed y “Castillo = recognized=1” coinciden con el código. Mentiras: (1) tabla “Puertas / Ahora” dice cuaderno → proto; el código inserta **`pre`**. (2) `premium` doc vs código: el doc dice peso ≥ 7 — y `isPremiumWeight` **sí** es ≥ 7 (eso está alineado). Rumbo todavía habla de sello prematuro. |
| `cuaderno.md` | **Viejo en recognized** | Dice `recognized=1` al confirmar hoja. Código: `recognized=0, stage=pre`. |
| `instagram.md` | **Viejo** | “Aprobar quantomos (recognized=1)”. El approve de bookmarks escribe `recognized=0, stage=proto`. |
| `reporte0708.md` | **Archivo** | Ya lo dice `reporteseptiembre4.md`. |
| `vector.md` | **Casi fiel** | Embebe `recognized=1`; el código además exige `stage=sealed`. |

### 2.1 `v0.7.1.md` — puntos que ya no son verdad (no reescribir aquí; no operar con ellos)

- Approve pone `recognized=1` — **no**.
- Pipeline de 3 estaciones STT→Cohere→pending_review — ahora es Fase A / voto / Fase B.
- Entidades no se persisten / matcher no se llama — **sí** se persisten en extract y `createEntityProposalsFromEntry` corre en approve y en `promoteToPre`.
- Castillo / Campamento / Calendario UX-GAP — hay UI.
- Captura texto UX-GAP — hay blobs, chats, Diálogo.
- Visión UX-GAP — hay OCR de cuaderno.
- `package.json` scripts: `dev` ya no es “solo Vite”; arranca API + UI.

### 2.2 Versión de paquete

`package.json` y `extension/manifest.json` = **0.1.0**. El producto se llama 0.7.1. `docs/upgrade-policy.md` ya lo nombra. No es bloqueo de uso; confunde backups y conversaciones entre instancias.

---

## 3. Deuda que traba el uso diario

Ordenada por daño al gesto del dueño: **corpus + HITL + sello**.

### P0 — Corpus / sello (esto es el producto hoy)

1. **No había camino para aplicar un voto externo al disco.** Export de proto existe (`Respaldo` → Protoquántomos, formato `deprocast-quantomos`). Fusionar respaldo **no** acepta ese JSON (“no se fusiona acá”). El 9 Sep votaste fuera y el flip `recognized=1` no ocurrió. **Hecho de producto + hueco de código.** Este PR añade `POST /api/quantomos/apply-seal` y un control en Respaldo.

2. **Castillo/Campamento mostraban 8 átomos.** `QuantomoPipePanels.tsx` `slice(0, 8)`. Con 680 proto el sello in-app es teatro. Este PR lista todos (scroll) y permite lote.

3. **Quántomos abre en Sellados.** Si `sealed=0` y `proto≈680`, la vista Corpus dice “Sin quántomos validados todavía”. El operador cree que no hay materia. El vacío no distinguía etapa.

4. **`chestSnapshot` cargaba todos los proto y pre** para que Trinchera pintara `.length`. Con cientos de filas es un hitch cada vez que abrís Calendario. Este PR cuenta con `COUNT(*)`.

5. **`GET /api/quantomos/:id`, `promoteToPre` y `sealQuantomo` releían la lista entera** (`listQuantomosByStage('all'|'pre'|'sealed').find`). Hipótesis de dolor con 680+ filas, ahora corregida con `getQuantomoById`.

### P0 — HITL audio (el otro gesto diario)

6. **Aduana funciona** (Criba 1–12 → extract → Validación). Auto-nav a Aduana solo si no estás en “stay home”. No es un bug; a veces se siente que “no salta”.

7. **Polling agresivo.** App: cada 5 s `pending + criba + pipeline + listPersons + listProjects`. CustomsPanel: 5 s. Validada: 10 s. Con roster grande es hitch. Hipótesis: el dashboard “pesado” no es React, es N+1 de propuestas (`proposals.ts` 3 queries por entry).

### P1 — Embudo sucio / puertas

8. **Approve de bookmarks es no-op para la cola.** `approveBookmarkQuantomos` hace `SET recognized=0, stage=proto` sobre filas que **ya** están así. La cola pending filtra `recognized=0`. La UI saca el ítem del DOM; al recargar **vuelve**. Hipótesis verificada en código, no en runtime. No se “arregla” poniendo `recognized=1` (rompería Castillo = único sello). Falta un estado de bookmark tipo `ACEPTADO` distinto de `PROCESADO_IA`. **No tocado en este PR** (puerta, no corpus).

9. **Cuaderno nace `pre`.** Salta Campamento. `quantomos.md` dice proto. Si el cuaderno rojo del 9 Sep ya está en pre, `apply-seal` sella directo — eso es lo correcto para esa materia.

10. **Directo no persiste.** Ok como oído; no cuenta como captura de corpus. El vacío “Activá la escucha” es honesto.

11. **El Cofre no está verificado en Chrome en este entorno.** Código MV3 + ingest existen. Dueño: se retira después. No invertir.

12. **L72 histórico.** Migración: `recognized=1` viejo → `stage=sealed` **sin** fila en `quantomo_lattices`. RAG los acepta (`isSealedQuantomoForRag`); `seal_ok` en inspector puede ser false. Hipótesis: Diálogo bebe texto sin física L72. Reseal uno a uno o lote con `apply-seal` sobre esos ids.

### P1 — Media / vault / auth

13. Bind 127.0.0.1 + token: correcto. Fricción operativa: mezclar `localhost` y `127.0.0.1`; dos `data/local-token` si Vite y server no comparten CWD; descargas `window.location.href = /api/backup/...` dependen del proxy de Vite para el header.

14. Vault: `resolveContained` sigue en pie (auditoría 26 ago). Cofres `.webm` hinchan el ZIP. Respaldo ya avisa si media > 200 MB.

15. Restore replace honesto (`dbCommitted` / `mediaStatus`). No reabrir.

### P2 — Superficie muerta / perf / docs

16. 21 vistas cableadas. Huecos reales: Finanzas/Derecho/Vitalidad en Núcleo; `PersonsSection` no embedded; FeedbackWidget sin labels `sentinela`/`atlas` (cae al id crudo).

17. Aleph / Mapa / Grafo 3D no bloquean el tubo. Aleph es telemetría teatral.

18. `src/services/api.ts` sigue gordo (DEPRO-026). No partir hoy.

19. SQLite en el event loop (DEPRO-023). Jobs + `busy_timeout` alcanzan para un operador. Benchmark 1k/5k/20k sigue pendiente.

20. Índice: vectores JSON + cosine in-process. `reporteseptiembre4.md` ya lo dijo: cientos sí, decenas de miles no. Rerank Cohere declarado, no cableado.

21. Contradicciones / claims / tabla de eventos: capacidad ~1. No es el trabajo de hoy.

22. OpenAPI cubre backup/ingest mínimo. Las rutas nuevas de sello no están ahí.

---

## 4. Lista de hoy (P0 / P1 / P2) con archivos

### P0 — shippear ya (este PR)

| # | Qué | Archivos |
| --- | --- | --- |
| A | Aplicar voto/export JSON → proto\|pre → sello L72 + `recognized=1` | `server/services/quantomoExport.ts`, `quantomoStages.ts`, `server/routes/quantomos.ts`, `src/services/api.ts`, `src/components/RespaldoSection.tsx` |
| B | Colas Campamento/Castillo sin tope 8 + lote Pre / Sellar | `src/components/calendario/QuantomoPipePanels.tsx`, `src/index.css` |
| C | Cofre de Trinchera: `COUNT(*)` en vez de arrays enteros | `server/services/quantomoStages.ts`, `src/services/api.ts`, `QuantomoPipePanels.tsx` |
| D | Vacío honesto en Corpus (Sellados vacío ≠ no hay proto) + Pre/Sellar en inspector | `src/components/QuantomosSection.tsx` |
| E | Lectura por id, no full-scan | `quantomoStages.ts`, `server/routes/quantomos.ts` |

Cómo usar **hoy** el voto del 9 Sep:

1. `npm run dev` (PATH de Node 24 en Windows).
2. Respaldo → **Aplicar voto (JSON)** con el archivo exportado (formato `deprocast-quantomos` o lista `{ ids }` o `{ quantomos: [{id}] }`).
3. Confirmar. El server hace proto→pre si hace falta, luego `sealQuantomo`. Embeddings al final, por entry, fire-and-forget.
4. Quántomos → filtro Sellados. Diálogo ya puede beberlos cuando Mnemosyne termine.

Si el JSON del 9 Sep **no** trae `id` de quántomo (export client-side viejo de Validada, sin ids), no se puede flinear. En ese caso: Calendario → Campamento **Pre todos** (si siguen proto) → Castillo **Sellar todos**.

### P1 — siguiente tanda (no este PR)

| # | Qué | Archivos |
| --- | --- | --- |
| F | Bookmarks: estado `ACEPTADO` para salir de pending sin `recognized=1` | `bookmarkProcess.ts`, `bookmarks.ts`, `CribaPanel.tsx` |
| G | Cuaderno: nacer `proto` o documentar que la hoja **es** Campamento | `notebookProcess.ts`, `cuaderno.md`, `quantomos.md` |
| H | Recortar polling 5 s / N+1 de `GET /api/proposals/pending` | `App.tsx`, `proposals.ts`, `CustomsPanel.tsx` |
| I | Export de Corpus alineado al dump `deprocast-quantomos` (stage, recognized, lattice) | `QuantomosSection.tsx` (este PR ya añade stage/recognized al JSON chico) |
| J | Reseal de `sealed` sin lattice (backfill histórico) | lote sobre ids con `seal_ok: false` |
| K | Marcar `v0.7.1.md` y `rumbo.md` como archivo / actualizar 4 líneas de rumbo (Castillo ya es el único sello) | no reescribir filosofía |

### P2 — no hoy

- El Cofre Chrome / Directo persistente / bus JSON entre instancias 0.7.2–0.7.5.
- Worker SQLite, FTS de transcripts, rerank, contradicciones, eventos como tabla.
- Partir `api.ts`. AmazonA, Aleph, Grafo 3D.
- LICENSE / filter-repo DEPRO-001 (gates del dueño).
- Subir `package.json` a `0.7.1` (cosmético; coordinar con manifest).

---

## 5. Qué **no** hacer

- No poner `recognized=1` en Aduana, bookmarks, chats o cuaderno. El sello es Castillo (o el apply-seal, que **llama** a Castillo).
- No inventar ejes AmazonA ni un sexto mapa.
- No rediseñar el OS ni unificar todas las puertas en un ingest omnívoro esta semana.
- No invertir en El Cofre MV3.
- No fusionar un dump `deprocast-quantomos` con “Fusionar respaldo”: eso espera el JSON/ZIP de universo, no el de etapa.

---

## 6. Verificación

En este entorno de auditoría:

- Lectura de `src/App.tsx`, `BrandNav.tsx`, `quantomoStages.ts`, `proposals.ts`, `bookmarkProcess.ts`, `notebookProcess.ts`, `quantomoExport.ts`, `RespaldoSection.tsx`, `QuantomosSection.tsx`, `QuantomoPipePanels.tsx`, `shared/oracleRag.ts`.
- **No** se corrió la UI contra tu `data/deprocast.db` de Windows. Conteos 680 / cuaderno rojo son verdad de dueño.
- Tras el PR: `npm test` y `npm run typecheck` en este repo.

Checklist operador (máquina local):

```
set PATH=%USERPROFILE%\bin\node-v24.18.0-win-x64;%PATH%
npm test
npm run typecheck
npm run doctor
npm run dev
```

- Respaldo muestra proto / pre / sellados.
- Aplicar voto con un JSON de prueba de 1 id (o el del 9 Sep).
- Quántomos → Sellados lista los ids.
- Calendario Alt+W / Alt+Q: la cola no se corta en 8.

---

## 7. Veredicto

0.7.1 **es** el producto en uso: kernel audio HITL, disco local, RAG sellado, 21 vistas. Lo que traba el día no es la captura ni El Cofre: es que **el Corpus se sella en un rail de 8 ítems** y **el voto externo no volvía al SQLite**. `v0.7.1.md` describe otro programa. `reporteseptiembre4.md` sigue siendo la mejor foto de madurez; este archivo la actualiza en el punto que te importa: materia → sello → `recognized=1`.
