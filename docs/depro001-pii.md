# DEPRO-001 — corte PII en HEAD

Fecha: 2026-08-25

- `ig_export.json` y el export de WhatsApp se dejaron de trackear; `.gitignore` cubre dumps.
- **No** se reescribió el historial Git (requiere orden explícita).
- Checklist operador: rotar tokens que hayan viajado en query de URLs de esos dumps; avisar afectados si aplica.
