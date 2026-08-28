# Upgrade / SBOM

- Versión única: `package.json` y `extension/manifest.json` (hoy 0.1.0).
- Artefacto de extensión: CI (`dist-extension`), no ZIP en Git.
- `npm ci` en CI; no `npm install` ad-hoc en main.
- `npm audit`: ver `docs/npm-audit-exceptions.md`. No overrides ciegos de deck/exceljs (DEPRO-013).
- Rollback: revertir el commit de release y restaurar backup verificado.
- SBOM: generar en release con `npx @cyclonedx/cyclonedx-npm` cuando se publique.
