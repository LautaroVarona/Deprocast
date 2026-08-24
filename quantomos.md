# Quántomos — Deprocast OS

```
documento   : quantomos.md
módulo      : Cofre · protoquántomo · prequántomo · Quántomo L72
versión     : 0.7.2
fecha       : 2026-08-24
```

El quántomo ya no es una fila plana que el import escribe a escondidas. Es **materia que madura**. Entra por el Cofre, votás 1–12, nace un protoquántomo; en Campamento lo reconocés, lo perfilás y lo anclás al tiempo; en Castillo se sella en 72 celdas y recién ahí bebe Mastropiero.

Nombre y explicación siguen siendo la cara humana. El Corpus premium solo admite **quántomos sellados**. Proto y pre son trabajo de trinchera y campamento, no semillas RAG.

---

## 1. Por qué existe este tubo

Tres hechos simultáneos, hasta ahora:

1. **Aduana sí vota 1–12** sobre audio. Ese gesto era el único HITL de calidad.
2. **El import de WhatsApp** (`chatProcess.ts`) insertaba quántomos `recognized = 1` sin voto. El Conversador destilaba y el Corpus tragaba.
3. **Diálogo** (Oráculo / agentes) no se podía terminar. Un hilo era un río sin desembocadura: no había cierre, no había peso, no había átomo.

El calendario ya nombraba **Trinchera / Campamento / Castillo** (`calendario.md`, `Alt+E` / `Alt+W` / `Alt+Q`). El dato no las obedecía. Este tubo alinea el objeto `quantomos` con esas tres escalas.

---

## 2. Las tres caras del mismo objeto

Una sola tabla. Un campo `stage`. No tres universos paralelos.

| Stage | Nombre de operador | Qué es | `recognized` |
| ----- | ------------------ | ------ | ------------ |
| `proto` | Protoquántomo | Destilado + voto 1–12. Título, texto, peso, origen. | `0` |
| `pre` | Prequántomo | NER, perfiles, vínculos, anclas de calendario. | `0` |
| `sealed` | Quántomo | Retículo L72 + sello HMAC. Corpus. | `1` |

El peso hermético **no se vuelve a votar** en Campamento ni en Castillo, salvo corrección explícita. Campamento enriquece. Castillo coagula.

`source_kind` + `source_id` recuerdan de dónde vino: `dialogo`, `chat_import`, `audio`, `blob`, `notebook`, `bookmark`, `manual`.

---

## 3. Trinchera / Cofre (`Alt+E`)

El **Cofre** es el input hiper amplio del día: hilos de Diálogo, bloques de WhatsApp, audio, blobs, notas.

Actividad humana mínima, innegociable:

1. **Terminar** el chat o la fuente.
2. **Votar 1–12** qué tan buena es esa data (misma escala que Aduana).
3. El destilador propone átomos; el cupo sigue `maxQuantomosForWeight` (1–3 → 1 átomo, …, 12 → 6).
4. Nacen **protoquántomos**.

Perfilar gente y meter chips del día sigue siendo interacción básica de trinchera. No es el grafo.

En la UI: panel Cofre en el rail de Trinchera. En Diálogo, el botón **Terminar** pide el peso y destila.

---

## 4. Chats con agentes

Hay dos sistemas (`chat.md`). Este tubo los trata distinto y los junta en el Cofre.

### Diálogo (Oráculo)

Ciclo de vida del hilo:

```text
open → [conversación] → Terminar → peso 1–12
     → destilador (tope según peso)
     → HITL corto aceptar/editar/tirar
     → protoquántomos ligados a thread_id
     → status = closed
```

Un hilo **cerrado** no acepta más mensajes. Addendum = hilo hijo nuevo, no reescritura silenciosa del voto.

### Conversador (import)

Deja de insertar `recognized = 1`. El bloque analizado nace como **proto**. Las `entity_proposals` **no** se disparan en el destilado crudo: esperan Campamento.

---

## 5. Campamento (`Alt+W`)

Cola semanal de protoquántomos. El humano hace el trabajo del campamento:

- NER HITL (hub de entidades ya existente, enganchado a la etapa proto)
- Categorizar: universo, tipología, polo Cuerpo/Mente/Alma, celda Amazona 6×6 si aplica
- Crear conexiones (suggested → confirmed)
- Anclar rutinas, actividades, eventos (`pending_tasks` / chips / matriz)
- **Validar pre** → `stage = pre`

Sin esta pasada no hay Castillo.

---

## 6. Castillo (`Alt+Q`)

Aquí se **procesa** lo pre-validado:

- Empaque L72, permutación por bloque de 9, sello HMAC → `stage = sealed`, `recognized = 1`
- `premium = 1` si peso ≥ 7 y sello válido y `generation ≥ 1`
- Grafos semánticos (Babel + resonancia de retículo)
- Mnemosyne embebe **solo** sellados
- Mastropiero retrieve filtra `sealed` + prioriza `premium`

El operador recibe el output interactuando con los personajes a su manera: Diálogo **abierto** lee el Castillo; al **cerrarlo** alimenta el Cofre. Un hilo no se destila a sí mismo en caliente.

---

## 7. Física L72

Geometría = poderes Deprocast: **8 dominios × 9 oficios** (`powerGeometry` en `src/lib/deprocast/geometry.ts`). Índice 0–71, visible 01–72.

| | |
| --- | --- |
| Celda | `int16` little-endian |
| Cuerpo | 72 × 2 = **144 bytes** |
| Permutación | Fisher–Yates **dentro de cada bloque de 9** (los dominios no se mezclan) |
| Semilla | `hash(run_id \|\| quantomo_id \|\| generation \|\| l72.v1)` |
| Sello | HMAC-SHA256 de celdas + id + generación + permutation_id |
| Clave | `DEPRO_LATTICE_KEY` o derivada del `app_runs.id` actual |

Título y `content` no desaparecen. Mnemosyne (`vector.md`) sigue siendo semántica continua. L72 es identidad + metadata + física de dominio.

Resonancia: coseno **por bloque de dominio**, ponderado por peso. Distinto del coseno Cohere. Score híbrido v1: FTS 0.25 · Mnemosyne 0.40 · L72 0.35.

Paquete **Q72** (API, export, backup): `id`, cara humana opcional, `lattice_b64`, `seal`, `codec`, `generation`, `permutation_id`.

No hay AES sobre SQLite. El sello es integridad + paquete de transmisión, no DRM contra el dueño de la RUN.

---

## 8. Puertas al tubo

Todas caen a **proto**. Ninguna sella sola.

| Puerta | Antes | Ahora |
| ------ | ----- | ----- |
| Audio / Aduana | `recognized=1` al approve | proto; sello en Castillo |
| Bookmarks | approve → `recognized=1` | proto |
| Chat import | INSERT `recognized=1` | proto |
| Diálogo | no destilaba | Terminar + voto → proto |
| Blobs / notas | INSERT `recognized=1` | proto |
| Cuadernos | confirm → `recognized=1` | proto (la hoja se aprueba; el átomo aún no es Corpus premium) |

Backfill: quántomos viejos `recognized=1` se marcan `sealed` **sin** lattice hasta reseal. Hilos Diálogo viejos quedan `open` hasta que los cierres.

---

## 9. Dónde vive

| Pieza | Ruta |
| ----- | ---- |
| Relato | `quantomos.md` |
| Codec L72 | `server/services/lattice72.ts` |
| Etapas / sello / colas | `server/services/quantomoStages.ts` |
| Schema | `server/db.ts` (`quantomos.stage`, `quantomo_lattices`) |
| Diálogo cerrar | `server/services/dialogo.ts`, `server/routes/dialogo.ts` |
| Import chat | `server/services/chatProcess.ts` |
| Aduana approve | `server/routes/proposals.ts` |
| RAG | `server/services/graph.ts` (`searchGraphContext`) |
| Embed | `server/services/embeddings.ts` (solo `stage=sealed`) |
| API quántomos | `server/routes/quantomos.ts` |
| UI Corpus | `src/components/QuantomosSection.tsx` |
| UI Diálogo | `src/components/dialogo/DialogoSection.tsx` |
| Cofre / colas | `src/components/calendario/QuantomoPipePanels.tsx` |
| Geometría 72 | `src/lib/deprocast/geometry.ts` |
| Backup | `server/services/backup.ts` (`quantomo_lattices`) |

---

## 10. Qué no es

- Entrenar o fingir ASI
- AES del SQLite entero
- 72 columnas SQL ni vector DB nueva
- Directo STT → Corpus
- UI de fusión de retículos
- Reabrir y re-votar en masa hilos históricos
- Tipologías de Campamento como workers autónomos

---

## 11. Relación con otros docs

| Doc | Relación |
| --- | -------- |
| `calendario.md` | Las tres dimensiones **son** las tres etapas del dato |
| `chat.md` | Diálogo vs Conversador; este tubo les da desembocadura común |
| `vector.md` | Mnemosyne no cambia de modelo; cambia **cuándo** embebe (solo sellado) |
| `cuaderno.md` | La hoja aprobada sigue existiendo; el átomo entra como proto |
| `IDA.md` | Ficha del organismo vs este tubo de aprendizaje destilado |

---

## 12. Contrato de operador

Cerrás el hilo. Votás. Nacen protoquántomos. En la semana los reconocés y los atás al mundo. En el ciclo los coagulás. Mastropiero lee lo sellado. Eso es el Corpus.
