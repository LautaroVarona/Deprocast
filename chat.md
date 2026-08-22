# Chat — Deprocast OS

```
documento   : chat.md
módulo      : Diálogo (Oráculo) · Chats import (Conversador)
versión     : 0.7.1
fecha       : 2026-08-20
```

Hay dos sistemas que la gente llama “chat”. No son el mismo módulo.

| Sistema | Qué es | Agente | Persistencia |
| -------- | -------- | -------- | -------------- |
| **Chats** | Import de .txt (WhatsApp u otras redes) → bloques por día → destilado | Conversador | `chat_sessions`, `chat_messages`, `chat_blocks` |
| **Diálogo** | Hilos operador ↔ Deprocast con RAG hiperpersonalizado | Oráculo | `dialogo_threads`, `dialogo_messages` |

El Dashboard es la puerta: buscar semántico (typeahead) o **Enter** → nuevo hilo de Diálogo.

---

## 1. Para qué existe Diálogo

Deprocast se consulta a sí mismo. El operador ancla entidades (persona, proyecto, agrupación, quántomo, dominio) y pregunta; el sistema recupera contexto del corpus (Mnemosyne + grafo) y responde con Cohere.

Visión operativa: **múltiples chats por sección** del OS, cada uno con instrucciones específicas. Hoy hay un prompt base + `section_key` nullable y `entity_refs`; las plantillas por sección llegan después.

---

## 2. Flujo Dashboard → Diálogo

```text
Dashboard
  ├─ click operador     → Respaldo
  ├─ click fecha        → Calendario
  ├─ typeahead (escribir) → ir a entidad / sección
  ├─ Enter en BUSCAR    → POST /api/dialogo/threads → vista Diálogo
  └─ pins (≤12)         → atajos a entidades del grafo
```

Pins viven en `dashboard_pins` (slot 0–11). Solo refs reales del grafo (no integraciones externas del boceto).

---

## 3. RAG (Oráculo + Mnemosyne)

Al enviar un mensaje:

1. Se persiste el turno `user`.
2. Se arma contexto:
   - fichas de `entity_refs` del hilo (si hay);
   - `searchGraphContext(query)` — top seeds semánticos + vecinos 1-hop.
3. System prompt base Deprocast + bloque de contexto.
4. Historial multi-turno del hilo → Cohere `/v2/chat` (texto libre).
5. Se persiste el turno `assistant`.

Sin streaming en v1. Sin Cohere Rerank aún (`COHERE_RERANK_MODEL` en env; deuda).

---

## 4. Contrato Oráculo (poder 30)

| | |
| --- | --- |
| **Input** | Pregunta del operador + `entity_refs` + historial del hilo |
| **Procesamiento** | Retrieve (grafo/embeddings) + Cohere multi-turno |
| **Output** | Respuesta grounded en el corpus de la RUN |

Poder visible **30** (índice 29), Memoria · Input · Alma · tipología omnívoro. Módulo `dialogo`.

Conversador (poder 28) sigue siendo **solo** import/destilado de chats externos. No es el chat del producto.

---

## 5. APIs

Base: `/api/dialogo`

| Método | Ruta | Uso |
| -------- | ------ | ----- |
| `GET` | `/threads` | Lista de hilos |
| `POST` | `/threads` | Crear (`title`, `section_key?`, `entity_refs?`) |
| `GET` | `/threads/:id` | Hilo + mensajes |
| `PATCH` | `/threads/:id` | Actualizar `entity_refs` / `title` / `section_key` |
| `POST` | `/threads/:id/messages` | Enviar mensaje usuario → respuesta assistant |
| `GET` | `/pins` | Hasta 12 pins del Dashboard |
| `PUT` | `/pins` | Reemplazar set de pins |

Typeahead del buscador reutiliza `GET /api/entities/typeahead`.

---

## 6. Datos y ciclo de vida

Tablas: `dialogo_threads`, `dialogo_messages`, `dashboard_pins`.

- Van al **respaldo** (`BACKUP_TABLES`).
- Son **actividad del operador**: el wipe NUEVO USUARIO las borra (`USER_ACTIVITY_TABLES`), igual que entries/chats import.

`entity_refs`: JSON `[{ "type": "person"|"project"|"agrupacion"|"quantomo"|"dominio", "id": "…" }]`.

---

## 7. Archivos

| Pieza | Ruta |
| ------- | ------ |
| Spec | `chat.md` |
| UI Dashboard | `src/components/DashboardSection.tsx` |
| UI Diálogo | `src/components/dialogo/DialogoSection.tsx` |
| API client | `src/services/api.ts` |
| Servicio | `server/services/dialogo.ts` |
| Cohere chat | `chatWithCorpus` en `server/services/cohere.ts` |
| Rutas | `server/routes/dialogo.ts` |
| Agente | `oraculo` en `src/lib/deprocast/agents.ts` |
| Poder 30 | `src/lib/deprocast/powers.ts` |

---

## 8. Deudas

- **Import WhatsApp / Chats:** el esquema `chat_*` y el pipeline Conversador hay que mejorar (bloques, cuota, re-index post-proceso). No es este módulo.
- Streaming SSE de respuestas.
- Plantillas de system prompt por `section_key` (calendario, mapa, IDA, …).
- Cohere Rerank post-retrieve.
- Pins de sistema (GitHub, cluster, models) del boceto — fuera de alcance hasta que existan como entidades.
