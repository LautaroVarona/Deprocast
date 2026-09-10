# Conocimiento — referentes bajo AmazonA

```text
documento   : conocimiento.md
módulo      : Conocimiento · Entidad_Conocimiento · GitHub
versión     : 0.8.0
fecha       : 2026-09-10
leer con    : quantomos.md · IDA.md · rumbo.md
después de  : geometría AmazonA (tridente → Lista6 → 6×6)
```

Deprocast ya te conoce por lo que grabás, escribís y votás. Esta capa es lo que **vos querés conocer**: repos, y el mismo tubo para papers, leyes, libros y un mapa de disciplinas. No es un segundo cerebro. Es un estante de **referentes** que se destilan al mismo átomo de siempre.

---

## 1. Para qué existe

Un bookmark muerto no sirve. Si guardás un repo es porque **resuelve un problema**. El sistema guarda vectores de utilidad, no solo nombre y URL:

- qué problema técnico o humano ataca
- cómo está armado (stack, arquitectura)
- si sigue vivo (último commit, issues, archivado)
- a qué celda de tu mapa AmazonA lo anclás

Utilidad concreta: mañana el Oráculo no cita el README. Cita el **quántomo** que vos votaste. El referente queda como ficha consultable, con vecinos y cruces.

---

## 2. Tres capas (no las mezcles)

```text
Mapa AmazonA          →  qué clases de saber existen y dónde se cruzan
Referente             →  la cosa del mundo (este repo, este paper)
Átomo (quántomo)      →  lo que vos destilaste, con voto 1–12
```

| Capa | Tablas / seeds | Wipe NUEVO USUARIO |
|------|----------------|-------------------|
| Mapa | tridentes, Lista6, `ama-matrix-conocimiento`, `ama-matrix-intersecciones` | No. Sobrevive. |
| Referente | `knowledge_entities` + satélites + vault `knowledge/` | Sí. Es de la RUN. |
| Átomo | `quantomos` `source_kind=knowledge` | Sí. Tubo proto → pre → sealed. |

El LLM llena campos del referente (editables). **No** escribe Corpus premium. [`shared/oracleRag.ts`](shared/oracleRag.ts) sigue bebiendo solo quántomos sellados. Los embeddings `object_type=knowledge` sirven para vecinos e intersecciones.

---

## 3. Geometría AmazonA

Regla: **Tridente (3) → Lista6 (2 tridentes) → matriz 6×6 (2 Lista6)**. El contenido no vive en `ama_cells`.

### Fuentes (qué es)

- Técnico: Repo · Paper · Dataset/tool
- Institucional: Ley · Libro · Curriculum

Lista6 `ama-lista6-conocimiento-fuentes`.

### Vectores de utilidad (qué extraer)

- Radiografía: Stack/método · Pulso/vigencia · Arquitectura
- Sentido: Problema que resuelve · Casos de uso · Cruce

Lista6 `ama-lista6-conocimiento-vectores`.

Matriz `ama-matrix-conocimiento` = fuentes × vectores. GitHub V1 implementa la fila **Repo** (las seis facetas). El resto es contrato vacío: el ingest de un paper o una ley enchufa el satélite sin romper el núcleo.

### Mapa de saber (cosas a aprender, no Wikipedia)

- Naturaleza: Matemática · Física/ondas · Biología
- Cultura: Humanidades · Norma (derecho/fiscalidad) · Organización/sistemas

Lista6 `ama-lista6-conocimiento-saber`. Matriz `ama-matrix-intersecciones` = saber × saber. Las celdas son hipótesis de cruce (electromagnetismo × organización). V1 siembra el tablero; V2 sugiere puentes.

Seeds: [`server/services/amazonaSeed.ts`](server/services/amazonaSeed.ts) (`seedConocimientoGeometry`).

---

## 4. Esquema (Entidad_Conocimiento)

SQLite no hereda tablas. Class-table inheritance:

- Núcleo `knowledge_entities`: kind, título, autor/org, URL, summary, `utility_problem`, `architecture_tldr`, `use_cases`, captura, status (`capturing|ready|error`), peso 1–12, `distilled_at`, dominios, tags, notes, `capture_mode` (`url|manual`).
- Satélite V1 `knowledge_repos`: owner, repo, branch, license, stack_json, stack_tags, languages, topics, last_commit, open_issues, stars, archived, pushed_at, README en vault, snapshot API.
- Satélites tipados vacíos: `knowledge_papers` (doi, abstract, year, venue), `knowledge_legal` (jurisdicción, boletín, artículos, vigencia), `knowledge_books` (isbn, year).
- Anclas N:N `knowledge_anchors` a una celda AmazonA (`conocimiento` o `interseccion`).
- FTS5 `knowledge_fts`. Embeddings `knowledge`.

---

## 5. Flujo GitHub (lo que el código hace hoy)

```text
URL o owner/repo  →  parse  →  GitHub REST (no scrape HTML)
                  →  manifiestos (package.json, requirements.txt, …)
                  →  tags de stack (Next, Tailwind, FFmpeg, Whisper, …)
                  →  pulso (commit / issues / archived)
                  →  README a vault/knowledge/{id}/readme.md
                  →  LLM: problema + TL;DR arquitectura/casos (editable)
                  →  ficha ready
                  →  voto 1–12  →  protoquántomos source_kind=knowledge
```

También: formulario a mano (mismos campos) y promover URLs GitHub de `link_harvest`.

Token opcional `GITHUB_TOKEN` en `.env`. Sin token: 60 req/h. Un repo usa varias llamadas.

UI: Captura → **Conocimiento**. Job family `knowledge` (cola `app_jobs`).

API: `/api/knowledge` (GET lista, POST url|manual, PATCH, DELETE, refresh, utility, distill, anchors, neighbors, from-harvest).

---

## 6. As-is vs contrato vacío

| Hay | No hay (V2+) |
|-----|----------------|
| Captura GitHub por URL y a mano | Ingest DOI / OpenAlex / arXiv |
| Stack automático + pulso | Scrape HTML de GitHub |
| LLM de utilidad editable | Referentes en `ORACLE_RAG_TYPES` |
| Destilado a proto con voto | Auto-sello L72 |
| Matrices AmazonA sembradas | Sugeridor automático de puentes |
| Vecinos knowledge + quantomo + ida | Curriculum fractal con 10k artículos |
| Tablas paper/legal/book | Crawler genérico de `link_harvest` |

El “super listado de aprender” **es el mapa** (Lista6 saber + celdas), no una enciclopedia. El contenido se llena con referentes, aprendizajes IDA y quántomos.

---

## 7. Cómo mejorarlo

1. `GITHUB_TOKEN` en la máquina de trabajo; botón de refresh de pulso ya existe — usarlo en lote.
2. Papers: OpenAlex / Crossref por DOI; satélite `knowledge_papers` ya está.
3. Leyes: BOE / EUR-Lex → `knowledge_legal` (jurisdicción + artículos).
4. Motor de intersecciones: al capturar un repo de ondas, si hay aprendizajes en Organización, proponer la celda Física×Organización.
5. Oráculo: canal opcional “referentes” con disclaimer, sin mezclarlo con Corpus sellado.
6. Si el corpus explota: sqlite-vss, mismo contrato `object_type` / `object_id` ([`vector.md`](vector.md)).
7. Curriculum fractal: cada ítem de saber puede abrir otra Lista6 (análisis, álgebra, …) sin tocar el núcleo.

---

## 8. Archivos

| Pieza | Path |
|-------|------|
| Schema | `server/db.ts` (`ensureKnowledgeTables`) |
| Servicio | `server/services/knowledge.ts` |
| GitHub | `server/services/knowledgeGithub.ts` |
| Stack | `server/services/knowledgeStack.ts` |
| LLM | `server/services/knowledgeLlm.ts` |
| Rutas | `server/routes/knowledge.ts` |
| UI | `src/components/ConocimientoSection.tsx` |
| Seeds | `server/services/amazonaSeed.ts` |
