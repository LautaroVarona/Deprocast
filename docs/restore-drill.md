# Restore drill

Cadencia: mensual. Owner: operador local.

1. Exportar ZIP/JSON desde Respaldo.
2. Si hay `BACKUP_PASSPHRASE`, comprobar que el dump es `.enc`.
3. Restore en copia (no producción) o merge en DB de prueba.
   El replace escribe primero `data/deprocast.restore.db` y media en `vault.staging/`;
   recién después hace swap. Si el swap de media falla, la respuesta trae
   `dbCommitted: true` y `mediaStatus: failed` (nunca un 500 silencioso).
4. Verificar: `PRAGMA foreign_key_check` vacío; un audio del vault abre; token local sigue funcionando.
5. Anotar fecha y fallos. Un 500 tras commit de DB es incidente (DEPRO-005).
