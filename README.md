# Deprocast

App local-first (HITL) para ingesta de audio, Cofre, grafo y respaldos. El server **solo escucha en 127.0.0.1**.

## Prerrequisitos

- Node **22.5+** (`node:sqlite`). En Windows:

  `set PATH=%USERPROFILE%\bin\node-v24.18.0-win-x64;%PATH%`

- ffmpeg (STT split). yt-dlp opcional (Instagram).

## Setup

```
npm ci
copy .env.example .env
# completar keys
npm run doctor
npm run dev
```

UI: http://127.0.0.1:5173 — API: http://127.0.0.1:3001

El proxy de Vite inyecta el **token local** (`data/local-token` o `LOCAL_API_TOKEN`). La extensión El Cofre lo pega desde Configuración.

## Scripts

| Script | Uso |
| --- | --- |
| `npm run dev` | API + Vite |
| `npm run server` / `start` | solo API |
| `npm test` | Vitest |
| `npm run typecheck` | tres tsconfig |
| `npm run build` / `build:extension` | web / Cofre |
| `npm run doctor` | Node, ffmpeg, yt-dlp |

## Datos sensibles

No commitear `.env`, `vault/`, `data/`, `ig_export.json`, exports de WhatsApp. Ver `.gitignore`.

El historial Git anterior puede contener dumps; reescribir historial es un paso aparte (DEPRO-001).

**Licencia:** el repo es `private`. No hay LICENSE hasta decisión del propietario.

## Docs

- `rumbo.md`, `reporte0708.md` — diseño / archivo
- `docs/threat-model-backup.md` — cifrado de backups
- `docs/slo.md`, `docs/restore-drill.md`, `docs/upgrade-policy.md`
- `docs/npm-audit-exceptions.md`
- `docs/openapi.yaml` — contrato mínimo
