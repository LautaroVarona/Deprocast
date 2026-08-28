# SLO locales (Fase 4)

| Indicador | Objetivo |
| --- | --- |
| Ingesta audio batch ≤ 16 ficheros | < 30 s hasta `queued` (sin STT) |
| Restore JSON mediano (< 50 MB) | < 60 s, respuesta honesta post-commit |
| p95 snapshot grafo 1k nodos | < 2 s |
| p95 snapshot grafo 5k nodos | < 8 s |
| Búsqueda similar top-K | < 500 ms en corpus 20k si hay vecinos precalculados |
| Recuperación jobs al boot | leases expirados reencolados; sin duplicar persist CAS |

Regresiones: `npm test` + `node scripts/benchmark-graph.mjs` en release.
