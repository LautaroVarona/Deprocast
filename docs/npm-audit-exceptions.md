# npm audit — excepciones (DEPRO-013)

Hasta el spike de reachability:

- **deck.gl / loaders.gl / texture-compressor**: no forzar override sin tests de mapa.
- **exceljs / uuid**: aislar uploads; no bump ciego.

CI corre `npm audit --audit-level=high` informativo (`|| true`) hasta que exista cadena corregida y tests de caracterización.
