# Auditoría DEPRO07 — 26 de agosto 2026

Documento de cierre de la tanda de endurecimiento del repo local `deprocast` (informe de 38 hallazgos). No reescribe historial Git, no añade LICENSE y no aplica overrides ciegos de dependencias (gates del propietario).

**Evidencia al cierre de esta tanda:** typecheck de web, server y extensión en verde; Vitest verde; `/api/health` solo booleans; mutaciones HTTP sin token → 401.

---

## 1. Qué se hizo (por fase)

### Fase 0 — Cortar riesgo activo

| ID | Qué cambió |
| --- | --- |
| **DEPRO-001** | `ig_export.json` y el chat de WhatsApp dejaron de trackearse. `.gitignore` cubre dumps (`ig_export.json`, `Chat de WhatsApp*.txt`, `*WhatsApp*.txt`). Corte documentado en `docs/depro001-pii.md`. Historial Git **no** se reescribió. |
| **DEPRO-036** | `/api/health` y logs de boot solo publican capacidades booleanas (`groq`, `cohere`, `openrouter`, `deepgram`, `perplexity`). Nada de longitud ni últimos 4 de keys. `/api/ready` es distinto (proceso listo vs. keys). |
| **DEPRO-002** | Una sola función `resolveContained` (`server/services/paths.ts`) para backup, vault, notebooks e Instagram. Rechaza absolutos, `..`, drives Windows, UNC y escape por symlink. Borrado de media por `entryId`, no por path de DB. |
| **DEPRO-004** | Límites ZIP (`server/services/zipLimits.ts`): entradas, tamaño por fichero, total descomprimido, ratio, timeout, limpieza. `copyMissingMediaFromZip` usa `resolveContained` y compara hash/tamaño en colisiones. Techo de upload ~4 GiB. |
| **DEPRO-003** | Token local (`LOCAL_API_TOKEN` o `data/local-token`). Header `X-Deprocast-Token` en todas las rutas salvo health. CORS allowlist `127.0.0.1:5173` / `localhost:5173`. Vite inyecta el token en `/api`. Extensión: pairing en Configuración + `chrome.storage`. WS exige token (query/header), sin fallback al token del server. |
| **DEPRO-009 / 032** | Offscreen espera escrituras de chunks (`Promise.allSettled`) **antes** de `putMeta` / `CAPTURE_READY`. Meta inicial al arrancar captura. El SW no sube si la secuencia no es contigua. |
| **DEPRO-006 / 007 / 010** | `maintenanceLock`: pausa pipeline, bookmark, notebook y research antes de restore. Drain con generación/CAS. Ingest batch: transacción + `batch_id` idempotente + 207 parcial + `finally` que borra temps. |
| **DEPRO-005** | Restore **replace** ya no escribe sobre la DB viva a ciegas. Dump → `data/deprocast.restore.db`; media → `vault.staging/` / `feedback.staging/`; `foreign_key_check`; swap de archivos; si el swap de media falla **después** del commit: `dbCommitted: true`, `mediaStatus: failed`. Colisiones por hash, no skip ciego. Merge sigue in-place bajo el lock. |
| **DEPRO-012** | URLs Instagram: `https` only, host exacto, sin userinfo/puerto, DNS privado/loopback bloqueado (`server/services/urlSafety.ts`). |

### Fase 1 — Red de seguridad

| ID | Qué cambió |
| --- | --- |
| **DEPRO-014** | Suite Vitest (`tests/`): paths, ZIP, CSV, URLs, crypto de backup, swap de restore, extras de sanitización. |
| **DEPRO-015** | `.github/workflows/ci.yml`: `npm ci`, typecheck de los 3 tsconfig, tests, build web/extensión, `npm audit` informativo, artefacto `dist-extension`. |
| **DEPRO-011** | Deepgram: `stat` + lectura async, tope de tamaño; no `readFileSync` de cientos de MiB. |
| **DEPRO-020** | Persistencia de URLs Cofre: origin+pathname, strip de userinfo/query/hash, allowlist de query. |
| **DEPRO-025** | Persons/projects: COUNTs agrupados (menos N+1); base para paginar/export. |
| **DEPRO-028** | `server/config.ts` + `.env.example` completo (`LOCAL_API_TOKEN`, `AI_RPM_LIMIT`, `BACKUP_PASSPHRASE`). `dotenv` sin `override: true`. |
| **DEPRO-029** | `csvEscape` prefix `'` para `= + - @` y whitespace/control. |
| **DEPRO-030** | Perplexity sin key → 503; stubs no se asimilan/embeben. |
| **DEPRO-031** | Descendientes y bosque de geografía acíclicos (BFS/`visited`). |
| **DEPRO-033** | SIGINT/SIGTERM: readiness false, `server.close`, abort workers/WS, checkpoint y `closeDb`. Completo de verdad cuando los jobs son durables (Fase 2). |
| **DEPRO-034** | README canónico (setup, PATH de Node, datos sensibles). `rumbo.md` etiquetado como diseño/archivo. |
| **DEPRO-035** | Versión única package/manifest. ZIP de extensión solo en CI; `dist-extension.zip` gitignored. |
| **DEPRO-037** | `scripts/dev.mjs` sin path personal hardcoded; `~/bin` + `engines` + mensaje genérico + `scripts/doctor.mjs`. |
| **DEPRO-038** | Repo `private`. **No** se añadió LICENSE. |

También se corrigieron errores de TypeScript que dejaban el typecheck inutilizable (tags `agrupacion`, `mergeFile` nullable, prompt de agrupación, typeahead, pdfjs canvas). CI **bloquea** merge si typecheck o tests fallan.

### Fase 2 — Durabilidad

| ID | Qué cambió |
| --- | --- |
| **DEPRO-008** | Tabla `app_jobs` (owner, lease, generation, intentos, DLQ). Recuperación de leases al boot. UI mínima en Configuración (`/api/config/jobs/*`). |
| **DEPRO-016** | `PRAGMA foreign_keys = ON`, `foreign_key_check` post-restore staging, `busy_timeout`. Inventario/cascades de filesystem **no** migrados como FKs de producto en todas las tablas. |
| **DEPRO-018** | Scripts `start` / `build:server` / `typecheck` con tsconfig.server. |
| **DEPRO-021 / 027** | Contratos en `shared/` (`httpSchemas.ts`, `idaGeometry.ts`). OpenAPI mínimo (`docs/openapi.yaml`). Tipos server/src de tags alineados. |
| **DEPRO-022** | `AppError`, `x-request-id`, health ≠ readiness. Logs de boot sin secretos. |
| **DEPRO-024** | ZIP de backup sigue empaquetando dump (+ cifrado opcional). No es un stream fila-a-fila de todas las tablas. |
| **DEPRO-026** | Extraído `src/services/http.ts`. `api.ts` sigue siendo un cliente gordo (~2.8k líneas). |
| **DEPRO-032** | Meta inicial + no subir chunks no contiguos (ver Fase 0). |

### Fase 3 — Arquitectura (con métricas, sin rediseño ciego)

| ID | Qué cambió |
| --- | --- |
| **DEPRO-017** | Vecinos top-K en `embedding_neighbors` al embeber; el grafo lee cache si existe. |
| **DEPRO-019** | Cifrado opcional de dump (`BACKUP_PASSPHRASE`, AES-GCM + HMAC). Threat model en `docs/threat-model-backup.md`. DB/vault vivos **no** cifrados. |
| **DEPRO-023** | `PRAGMA busy_timeout = 5000` + cola de jobs. **No** hay worker thread de SQLite (el plan pedía no rediseñar sin benchmarks 1k/5k/20k). |

### Fase 4 — Continuo

- SLO locales: `docs/slo.md`
- Restore drill: `docs/restore-drill.md`
- Política upgrade/SBOM: `docs/upgrade-policy.md`
- Excepciones audit: `docs/npm-audit-exceptions.md`
- Benchmark de grafo: `scripts/benchmark-graph.mjs`

---

## 2. Cómo se mejoró (efecto, no lista de archivos)

**Exposición.** Antes: CORS abierto, health filtraba sufijos de keys, cualquier proceso local podía mutar/exportar/IA/WS. Ahora: origen allowlist, health ciego a secretos, capacidad local con token. La UI no cambia de UX porque Vite inyecta el header.

**Filesystem.** Antes: `copyMissingMediaFromZip` hacía `path.join(VAULT_DIR, …)` y un ZIP hostil podía escribir fuera del vault; `uncompSize` no limitaba bytes. Ahora: paths canónicos + presupuesto ZIP **antes** de escribir; tests de caracterización (absolutos, `..`, ratio).

**Pérdida / mentira en restore.** Antes: restore podía correr con colas vivas; un fallo de media tras COMMIT devolvía error genérico. Ahora: lock de mantenimiento, staging de DB/media, respuesta honesta (`dbCommitted` / `mediaStatus`).

**Ingesta y Cofre.** Antes: chunks en IndexedDB se daban por escritos (race); ingest batch `renameSync`+`INSERT` sin transacción; `forceUnlock` podía duplicar drains. Ahora: await de pendientes, lote atómico/idempotente, CAS de generación.

**Proveedores y datos.** URLs de Instagram ya no se validan con un regex laxo (SSRF). URLs Cofre se persisten sin query/hash. CSV no es vector de fórmulas. Perplexity sin key no finge investigación.

**Operación.** Había cero tests y cero CI. Hay red de seguridad (typecheck ×3, Vitest, build, artefacto de extensión). README y `doctor` cubren el PATH de Node 24. Shutdown deja de matar el proceso con writers a medias.

**Durabilidad.** Jobs sobreviven un crash (lease/DLQ). Top-K evita recomputar vecinos en el request del grafo. Backups pueden ir cifrados si el operador pone frase.

---

## 3. Qué falta (ordenado por riesgo / decisión)

### Gates del propietario (no improvisar)

1. **DEPRO-001 historial.** Los dumps siguen en commits viejos. `git filter-repo` / BFG **solo** con orden explícita (rompe clones/forks). Mientras tanto: rotar tokens que hayan viajado en query de esos exports.
2. **DEPRO-038 licencia.** Elegir LICENSE antes de publicar nada. El repo es `private`; no hay SPDX.
3. **DEPRO-013.** Spike de reachability de deck/exceljs **antes** de overrides. `npm audit` en CI es informativo (`|| true`).

### Huecos de producto / ingeniería

4. **DEPRO-023 worker DB.** SQLite sigue en el event loop. `busy_timeout` + jobs no son un worker. Tiene sentido **después** de `node scripts/benchmark-graph.mjs` en 1k/5k/20k.
5. **DEPRO-024 export streaming.** El dump JSON/ZIP todavía materializa tablas en memoria. Snapshot SQLite + checksums de manifest sería el siguiente paso de copy grande.
6. **DEPRO-026.** `src/services/api.ts` (y secciones gordas del server) no se partieron de verdad; solo salió el helper HTTP.
7. **DEPRO-016 FKs de dominio.** `foreign_key_check` corre en restore staging, pero no hay migración completa `ON DELETE` + inventario de huérfanos + saga de filesystem (borrar `vault/<id>/` no está atado a FK).
8. **DEPRO-008 unificación.** Las colas históricas (pipeline/bookmark/notebook/research) conviven con `app_jobs`. El stopgap de Fase 0 no las reescribió todas al mismo runtime.
9. **DEPRO-019 almacén del SO.** Cifrado de backups con frase de env. No hay DPAPI/keychain ni cifrado de DB/vault vivos (y el threat model dice que no hay que hacerlo sin runbook de recuperación).
10. **DEPRO-021 contratos.** OpenAPI y Zod cubren backup/ingest/run a mínimo. Falta el resto de rutas destructivas y unificar del todo `server/types.ts` ↔ `src/types.ts`.
11. **DEPRO-022 observabilidad.** Correlation id existe; logs JSON redactados de punta a punta y métricas de cola no están cerrados.
12. **DEPRO-032 Cofre.** Chunks huérfanos: política de retención/borrado aún no decidida.
13. **Suite.** Hay tests de invariantes de riesgo, no 40+ ni harness fuerte de extensión/Supertest con DB temporal en todos los caminos (restore E2E, ingest 207, WS).
14. **Proceso vivo.** Si `:3001` arrancó **antes** de esta tanda, hay que reiniciar `npm run dev` para que rija staging restore, token y health actuales. Vite y server deben compartir el mismo `data/local-token`.

### Fuera de alcance a propósito

- LAN / multiusuario: exige threat-model review nueva.
- Postgres: no, mientras sea single-user local-first.
- Publicar datasets como fixtures de test.

---

## 4. Cómo verificar (operador)

```
set PATH=%USERPROFILE%\bin\node-v24.18.0-win-x64;%PATH%
npm test
npm run typecheck
npm run doctor
```

- `GET /api/health` → booleans, sin token.
- `GET /api/backup/summary` sin header → 401.
- Configuración → copiar token (UI y extensión).
- Restore: respuesta con `dbCommitted` / `mediaStatus`; si media falla no debe ser un 500 mudo.
- Drill mensual: `docs/restore-drill.md`.

---

## 5. Archivos de referencia

| Área | Dónde |
| --- | --- |
| Paths / ZIP | `server/services/paths.ts`, `zipLimits.ts`, `backupZip.ts` |
| Auth | `server/services/localAuth.ts`, `vite.config.ts`, `extension/auth.ts` |
| Restore staging | `server/services/restoreSwap.ts`, `server/routes/backup.ts` |
| Lock / jobs | `server/services/maintenance.ts`, `jobs.ts`, `server/db.ts` |
| Crypto backups | `server/services/backupCrypto.ts`, `docs/threat-model-backup.md` |
| Tests / CI | `tests/`, `vitest.config.ts`, `.github/workflows/ci.yml` |
| Ops | `README.md`, `docs/slo.md`, `docs/restore-drill.md`, `docs/upgrade-policy.md` |
