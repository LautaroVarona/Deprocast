# Threat model — backups (DEPRO-019)

## Activos

- SQLite (`data/deprocast.db`), vault de audio/páginas, dumps JSON/ZIP.

## Amenazas en alcance (local-first, un operador)

- Lectura de un ZIP de respaldo robado (USB, nube).
- Alteración de dump.json (integridad).
- No cubre: atacante con el mismo usuario de Windows y la frase memorizada.

## Controles

- `BACKUP_PASSPHRASE` → AES-256-GCM + HMAC del ciphertext (`server/services/backupCrypto.ts`).
- Sin frase: dump en claro (modo actual).
- La clave **no** se deriva del login OS todavía; recuperación = la frase del operador.
- Firma de commits/releases: recomendable, no implementada.

## Recuperación de clave

1. Sin frase, un `.enc` no se restaura.
2. Guardar la frase fuera del repo (gestor de contraseñas).
3. Simulacro: `docs/restore-drill.md`.

No cifrar la DB viva sin almacén del SO y runbook; riesgo de pérdida definitiva.
