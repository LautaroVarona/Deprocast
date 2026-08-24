# Sentinela

```text
documento   : sentinela.md
módulo      : Sentinela
versión     : 1.0
fecha       : 2026-08-24
vista       : nav Sentinela (hermana de Diálogo)
alma        : server/prompts/alma-sentinela.md
API         : /api/sentinela
```

Sentinela es el **inspector del organismo**: instancias que leen producto y código, arman un perfil al nacer, y después ejecutan **misiones por comando escrito**. No es el Oráculo. El Oráculo habla del corpus personal. La Sentinela habla de Deprocast mismo.

No reescribe TypeScript. No sella quántomos. No aprueba Aduana. Si se vuelve más eficiente, es porque guarda **skills propias** (recetas de tools) en borrador, hasta que vos las aceptás.

Leer con: [`IDA.md`](IDA.md) · [`rumbo.md`](rumbo.md) · [`v0.7.1.md`](v0.7.1.md) · [`chat.md`](chat.md).

---

## 1. Una frase

Al crear `sentinela_001` inspecciona. Recién cuando el perfil está listo, un comando escrito es una misión IPO. Podés pausar, cambiar instrucciones y reanudar. El cerebro es Cohere; la memoria, Mnemosyne; los sentidos (Deepgram, pipeline) los **mira**, no los sustituye.

---

## 2. Nacimiento ≠ análisis

Son dos fases distintas.

**Inspección (al crear).** El server asigna `sentinela_001`, `sentinela_002`… y corre un job `inspecting` → `ready`:

- Catálogos IPO ya en código: `src/lib/deprocast/modules.ts`, `agents.ts`, `powers.ts`.
- Todos los `*.md` de la raíz del repo.
- Censo vivo: entries, quántomos, personas, proyectos, pipeline, health/Cohere.
- Lectura acotada de archivos citados en `module.files` (tope de bytes).

Con eso Cohere sintetiza un **perfil** (qué es Deprocast, mapa de módulos, huecos, contratos IPO). El perfil se guarda y se embebe. Si el LLM no responde, queda un perfil heurístico con el harvest recortado. Podés abortar.

**Análisis (después).** Cada comando es una **misión IPO**: intro (perfil + alma), instrucciones (el comando, editables), recursos (MD / módulo / retrieve), output esperado. Turno a turno, con tools allowlist + RAG. Pausar congela el job; cambiar instrucciones y reanudar inyecta el texto nuevo en el siguiente turno.

El mapa jugable y el clic por la UI quedan **fuera de v1**.

---

## 3. Piezas (ya existían; v1 las ensambla)

| Pieza | Dónde | Qué hace acá |
|-------|--------|----------------|
| Cerebro | Cohere `chatWithCorpus` / `chatWithTools` | Loop de tools, tope de rondas |
| Mnemosyne | tabla `embeddings` + cosine | Embebe perfil, skills y MD; retrieve junto a quántomos |
| Sentidos | Deepgram + extract / pipeline / Directo | La Sentinela los inspecciona; no los opera |
| Alma | `server/prompts/alma-sentinela.md` | Prompt maestro en cada turno. No se mezcla con el Oráculo. Nunca se devuelve al cliente |

Agente de catálogo: `sentinela` (tipología omnívoro, módulo `sentinela`, status `vivo`, poder 71).

---

## 4. Datos

Tablas nuevas, incluidas en el respaldo. **No** se borran en wipe de nuevo usuario (el perfil habla del código; el corpus personal se vacía aparte). Los embeddings `sentinel_profile`, `sentinel_skill` y `doc` también se conservan en ese wipe.

| Tabla | Qué guarda |
|-------|------------|
| `sentinel_agents` | `code` (`sentinela_001`), `status` (`inspecting` \| `ready` \| `running` \| `paused` \| `error`), `profile_md` |
| `sentinel_missions` | intro, instrucciones, recursos, output esperado, status, `paused_at` |
| `sentinel_messages` | hilo `user` \| `assistant` \| `system` \| `tool` |
| `sentinel_events` | log (`note` \| `observation` \| `timing` \| `suggestion` \| `error` \| `tool`) |
| `sentinel_skills` | contrato IPO + `kind` + `body_json`. Status `draft` \| `accepted` \| `rejected` |

Tipos Mnemosyne: `sentinel_profile`, `sentinel_skill`, `doc`.

---

## 5. Alma y geometría

El archivo del alma dice quién es (Sentinela de esta RUN, no Oráculo), opera sobre **AmazonA 6×6** (Lista6 = 2 tridentes; ver `IDA.md` / `calendario.md` — no inventar “6 dimensiones” aparte de las 9 de arquitectura en `v0.7.1.md`), HITL 1–12, y la regla RAG: **priorizar quántomos recuperados + perfil + skills + docs indexados**; si no hay evidencia, declararlo.

---

## 6. Tools allowlist (sin shell, sin escribir código)

Loop Cohere Chat v2, intérprete en `server/services/sentinel.ts`, tope de 8 rondas.

| Tool | Hace |
|------|------|
| `read_doc` | Solo `*.md` de la raíz. El alma no se lee como doc de misión |
| `read_source` | Solo rutas bajo `src/` y `server/` citadas en catálogos, con tope de bytes |
| `catalog` | Módulos / agentes / poderes |
| `census` | Conteos SQLite + pipeline |
| `probe_get` | GET nombrados: `pipeline`, `entries`, `quantomos`, `health`. Sin POST de ingesta |
| `search_corpus` | RAG: quántomos, perfil, skills, docs, grafo |
| `write_note` | Persiste en `sentinel_events` |
| `propose_skill` | Skill en borrador. El operador la acepta (HITL) |
| `run_skill` | Ejecuta una skill **aceptada** (receta de esas mismas tools) |
| `request_pause` | Pasa la misión a `paused` |

**Skills.** Al aceptarse, `body_json` es una receta de pasos de esas tools (checklist / probe / lectura). En misiones siguientes el modelo las ve y el intérprete las corre. Así se vuelven más eficientes **sin** mutar Deprocast. Una skill aceptada con peso 1–12 puede bajar a ficha IDA `organismo`.

---

## 7. UI y API

Nav en `src/App.tsx` junto a Diálogo. Vista `sentinela`. Estilo dashboard (`is-dashboard-mode`).

`src/components/sentinel/SentinelSection.tsx`: lista de instancias, crear, abortar inspección, perfil, skills, misiones, chat, log, Pausar / Reanudar / editar instrucciones.

Inspección y turnos largos: job en server + poll (~1.5 s). El POST inicial no espera al LLM.

Router: `server/routes/sentinel.ts` montado en `/api/sentinela`.

```text
GET/POST   /api/sentinela/agents
GET        /api/sentinela/agents/:id          (bundle: agent + missions + messages + skills + events)
POST       /api/sentinela/agents/:id/abort
POST       /api/sentinela/agents/:id/missions
POST       /api/sentinela/missions/:id/messages
POST       /api/sentinela/missions/:id/pause
POST       /api/sentinela/missions/:id/resume
PATCH      /api/sentinela/missions/:id        (instrucciones / output esperado)
POST       /api/sentinela/skills/:id/accept   (weight 1–12, promote_ida opcional)
POST       /api/sentinela/skills/:id/reject
```

---

## 8. Cómo usarla

1. Nav **Sentinela** → **+ Nueva**.
2. Esperá `inspecting` → `ready` (o abortá).
3. Escribí un comando, p.ej. *recorrê Aduana: contrato IPO vs lo que hay en DB y proponé un cuello de tiempo*.
4. Si se alarga: **Pausar**, editar instrucciones, **Reanudar**.
5. Si propone una skill: pestaña **skills**, peso 1–12, Aceptar o Rechazar. Con peso alto puede bajar a IDA.

El perfil y el log persisten al recargar. El wipe de nuevo usuario no los borra.

---

## 9. Qué no entra en v1

- `sqlite-vss` (sigue cosine in-process; `vector.md` lo marca como paso siguiente).
- Gemini / Perplexity como cerebro (es Cohere).
- Fixtures de audio por el pipeline, Playwright, mapa jugable.
- Reescritura autónoma de TypeScript (IDA: aplicar deja rastro, no parchea).

---

## 10. Archivos

```text
server/prompts/alma-sentinela.md
server/services/sentinel.ts
server/routes/sentinel.ts
src/components/sentinel/SentinelSection.tsx
src/lib/deprocast/agents.ts          (agente sentinela)
src/lib/deprocast/modules.ts         (módulo sentinela)
src/lib/deprocast/powers.ts          (poder 71)
```
