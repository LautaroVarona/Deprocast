import type {
  DeproContract,
  DeproPower,
  DeproPowerStatus,
  DeproTypology,
} from '../../types'
import { AGENT_CATALOG } from './agents'
import {
  DEPRO_DOMAIN_META,
  oficioLabel,
  powerGeometry,
  powerNumber,
} from './geometry'

type NamedPower = {
  name: string
  status: DeproPowerStatus
  notes: string
  contract: DeproContract
  agentIds: string[]
  typology?: DeproTypology
}

function ipo(input: string, processing: string, output: string): DeproContract {
  return { input, processing, output }
}

const NAMED: Record<number, NamedPower> = {
  0: {
    name: 'Escriba',
    status: 'cargado',
    notes: 'STT. La oreja del organismo.',
    contract: ipo(
      'Archivo de audio.',
      'Deepgram + split.',
      'Transcripción en cola.',
    ),
    agentIds: ['escriba'],
    typology: 'vectorizador',
  },
  1: {
    name: 'Blob',
    status: 'cargado',
    notes: 'Nota rápida con menciones.',
    contract: ipo(
      'Texto del operador.',
      'Destilar quántomo.',
      'Nodo sin pasar por Aduana de audio.',
    ),
    agentIds: ['blob'],
    typology: 'vectorizador',
  },
  3: {
    name: 'Partidor',
    status: 'cargado',
    notes: 'Audio largo → segmentos.',
    contract: ipo('Audio largo.', 'Split.', 'Hijos queued.'),
    agentIds: ['partidor'],
    typology: 'ejecutivo',
  },
  4: {
    name: 'Destilador',
    status: 'cargado',
    notes: 'Cohere extract sobre transcripción.',
    contract: ipo(
      'Texto fuente.',
      'Título, quántomos, acciones, entidades.',
      'Proposal bundle.',
    ),
    agentIds: ['destilador'],
    typology: 'generativo',
  },
  7: {
    name: 'Manifiesto',
    status: 'cargado',
    notes: 'Lo que sale de Captura hacia HITL.',
    contract: ipo(
      'Extract crudo.',
      'Empaquetar proposal.',
      'pending_criba / pending_review.',
    ),
    agentIds: ['destilador', 'aduanero'],
    typology: 'ejecutivo',
  },
  9: {
    name: 'Aduanero',
    status: 'cargado',
    notes: 'HITL de audio. Peso y speakers.',
    contract: ipo(
      'Entry pending_criba.',
      'Peso 1–12, mapa de voces.',
      'Cribado listo para extract.',
    ),
    agentIds: ['aduanero', 'diarizador'],
    typology: 'clasificador',
  },
  10: {
    name: 'Cribador',
    status: 'cargado',
    notes: 'Bookmarks Twitter / Instagram.',
    contract: ipo(
      'Post/reel importado.',
      'Peso + banda de media.',
      'Procesar o slop.',
    ),
    agentIds: ['cribador'],
    typology: 'clasificador',
  },
  12: {
    name: 'Balanza',
    status: 'bosquejo',
    notes: 'El peso 1–12. Hoy humano; mañana sugerido.',
    contract: ipo(
      'Señal + contexto.',
      'Sugerir peso hermético.',
      'Draft para el operador.',
    ),
    agentIds: ['auto-peso', 'aduanero'],
    typology: 'clasificador',
  },
  13: {
    name: 'Cinta',
    status: 'bosquejo',
    notes: 'Cola de alto valor y enrich de reels.',
    contract: ipo(
      'Bookmark de peso alto.',
      'STT/OCR/frames.',
      'Material para el Destilador.',
    ),
    agentIds: ['media-enrich', 'cribador'],
    typology: 'crawler',
  },
  16: {
    name: 'Sello',
    status: 'cargado',
    notes: 'Approve / reject. Congela Validada.',
    contract: ipo(
      'Proposal editada.',
      'Firmar o descartar.',
      'Entry approved + NER pendiente.',
    ),
    agentIds: ['sello'],
    typology: 'ejecutivo',
  },
  18: {
    name: 'Visionario',
    status: 'cargado',
    notes: 'OCR / visión de páginas y frames.',
    contract: ipo(
      'Imagen de página.',
      'Unlimited-OCR o Cohere Vision.',
      'Transcripción + layout.',
    ),
    agentIds: ['visionario'],
    typology: 'crawler',
  },
  19: {
    name: 'Índice',
    status: 'cargado',
    notes: '160 caras, spreads, estado del cuaderno.',
    contract: ipo(
      'Cuaderno físico o digital.',
      'Indexar slots y status.',
      'Mapa de caras.',
    ),
    agentIds: ['visionario'],
    typology: 'clasificador',
  },
  22: {
    name: 'Exegeta',
    status: 'cargado',
    notes: 'Explain de página validada.',
    contract: ipo(
      'Página validada.',
      'Comentar + NER.',
      'Explanation enlazada.',
    ),
    agentIds: ['exegeta'],
    typology: 'generativo',
  },
  25: {
    name: 'Página viva',
    status: 'cargado',
    notes: 'Salida de Biblioteca hacia Memoria.',
    contract: ipo(
      'Explain + entidades.',
      'Materializar entry/quantomo.',
      'Nodo en el corpus.',
    ),
    agentIds: ['exegeta'],
    typology: 'generativo',
  },
  27: {
    name: 'Conversador',
    status: 'cargado',
    notes: 'Bloques de chat por día.',
    contract: ipo(
      'Export .txt.',
      'Destilar el día.',
      'Quántomo + URLs.',
    ),
    agentIds: ['conversador'],
    typology: 'vectorizador',
  },
  28: {
    name: 'Onomasta',
    status: 'cargado',
    notes: 'Nombres: create, link, merge.',
    contract: ipo(
      'Menciones y proposals.',
      'HITL + matchmakers.',
      'Grafo de entidades.',
    ),
    agentIds: ['onomasta'],
    typology: 'clasificador',
  },
  29: {
    name: 'Oráculo',
    status: 'cargado',
    notes: 'Chat operador ↔ Deprocast con RAG. Ver chat.md.',
    contract: ipo(
      'Pregunta + entity_refs + historial.',
      'GraphRAG + Cohere multi-turno.',
      'Respuesta grounded.',
    ),
    agentIds: ['oraculo'],
    typology: 'omnivoro',
  },
  31: {
    name: 'Mnemosyne',
    status: 'cargado',
    notes: 'Embeddings. Memoria de largo plazo.',
    contract: ipo(
      'Texto del corpus.',
      'Embed + rerank.',
      'Vectores y suggested links.',
    ),
    agentIds: ['mnemosyne', 'link-crawler'],
    typology: 'crawler',
  },
  32: {
    name: 'Tejedor',
    status: 'cargado',
    notes: 'Aristas del grafo Babel.',
    contract: ipo(
      'Co-ocurrencia + similarity.',
      'Scoring de vínculos.',
      'Grafo confirmado / suggested.',
    ),
    agentIds: ['tejedor'],
    typology: 'crawler',
  },
  33: {
    name: 'Explorador',
    status: 'cargado',
    notes: 'Investigación web vía Perplexity → cuarentena IDA.',
    contract: ipo(
      'Tema libre (manual).',
      'Sonar + chunking local.',
      'Hallazgos pendientes de HITL.',
    ),
    agentIds: ['explorador', 'explorador-academico', 'explorador-mercado'],
    typology: 'crawler',
  },
  34: {
    name: 'Quántomo',
    status: 'cargado',
    notes: 'Átomo de conocimiento.',
    contract: ipo(
      'Fuente destilada.',
      'Peso hermético / humano.',
      'Nodo en la biblioteca de quántomos.',
    ),
    agentIds: ['destilador'],
    typology: 'generativo',
  },
  36: {
    name: 'Cronista',
    status: 'cargado',
    notes: 'Tiempo: trinchera, campamento, castillo.',
    contract: ipo(
      'Occurrences del rango.',
      'Escalar el día.',
      'Agenda visible.',
    ),
    agentIds: ['cronista'],
    typology: 'ejecutivo',
  },
  37: {
    name: 'Cartógrafo',
    status: 'cargado',
    notes: 'H3, capas, radar.',
    contract: ipo(
      'Punto o hex.',
      'Resolve place + occupancy.',
      'Vista táctica.',
    ),
    agentIds: ['cartografo'],
    typology: 'crawler',
  },
  40: {
    name: 'Campo',
    status: 'cargado',
    notes: 'Matrices AmazonA 3×3 / 6×6.',
    contract: ipo(
      'Listas + ciclo.',
      'Celdas del hoy.',
      'Campo operativo.',
    ),
    agentIds: ['campo'],
    typology: 'ejecutivo',
  },
  43: {
    name: 'Habitar',
    status: 'cargado',
    notes: 'Quién ocupa un lugar.',
    contract: ipo(
      'Entidad + place.',
      'Occupy / unoccupy.',
      'Capa de ocupación.',
    ),
    agentIds: ['cartografo'],
    typology: 'ejecutivo',
  },
  45: {
    name: 'Haber',
    status: 'bosquejo',
    notes: 'Entrada de hechos económicos.',
    contract: ipo(
      'Movimiento, factura, nota.',
      'Normalizar.',
      'Hecho contable crudo.',
    ),
    agentIds: ['contable'],
    typology: 'vectorizador',
  },
  48: {
    name: 'Contable',
    status: 'bosquejo',
    notes: 'Clasificar el dinero.',
    contract: ipo(
      'Hechos crudos.',
      'Cuenta, periodo, proyecto.',
      'Libro mayor.',
    ),
    agentIds: ['contable'],
    typology: 'clasificador',
  },
  51: {
    name: 'Flujo',
    status: 'bosquejo',
    notes: 'Caja y obligaciones.',
    contract: ipo(
      'Libro + calendario.',
      'Proyectar.',
      'Deberes y liquidez.',
    ),
    agentIds: ['tributario'],
    typology: 'ejecutivo',
  },
  54: {
    name: 'Norma',
    status: 'bosquejo',
    notes: 'Archivo normativo.',
    contract: ipo(
      'Ley, expediente, nota.',
      'Tematizar fuero y plazos.',
      'Ficha jurídica.',
    ),
    agentIds: ['legista'],
    typology: 'vectorizador',
  },
  57: {
    name: 'Legista',
    status: 'bosquejo',
    notes: 'Leer el derecho sobre un caso.',
    contract: ipo(
      'Ficha + contexto de partes.',
      'Riesgo, plazos, huecos.',
      'Opinión de archivo (no dictamen).',
    ),
    agentIds: ['legista'],
    typology: 'clasificador',
  },
  60: {
    name: 'Pacto',
    status: 'bosquejo',
    notes: 'Contratos versionados.',
    contract: ipo(
      'Borrador + partes.',
      'Redactar / contrastar.',
      'Cláusula viva.',
    ),
    agentIds: ['contractual'],
    typology: 'generativo',
  },
  63: {
    name: 'Soma',
    status: 'bosquejo',
    notes: 'Cuerpo. Sueño, carga, dolor.',
    contract: ipo(
      'Señal somática.',
      'Traducir a Cuerpo.',
      'Ajuste del día.',
    ),
    agentIds: ['soma', 'medico-archivo'],
    typology: 'omnivoro',
  },
  64: {
    name: 'Noos',
    status: 'bosquejo',
    notes: 'Mente. Atención y foco.',
    contract: ipo(
      'Carga cognitiva de la RUN.',
      'Traducir a Mente.',
      'Qué merece foco.',
    ),
    agentIds: ['noos'],
    typology: 'omnivoro',
  },
  65: {
    name: 'Pneuma',
    status: 'bosquejo',
    notes: 'Alma. Rito y ciclo 28.',
    contract: ipo(
      'Ánimo, rito, luna.',
      'Traducir a Alma.',
      'Brújula.',
    ),
    agentIds: ['pneuma'],
    typology: 'omnivoro',
  },
  67: {
    name: 'Carga',
    status: 'bosquejo',
    notes: 'Deporte: carga y descanso.',
    contract: ipo(
      'Sesión + recuperación.',
      'Leer el ciclo.',
      'Plan del día.',
    ),
    agentIds: ['entrenador'],
    typology: 'ejecutivo',
  },
  70: {
    name: 'Mesa',
    status: 'bosquejo',
    notes: 'Nutrición.',
    contract: ipo(
      'Comidas y compras.',
      'Patrones.',
      'Mesa del día.',
    ),
    agentIds: ['nutricionista'],
    typology: 'generativo',
  },
  71: {
    name: 'Núcleo',
    status: 'cargado',
    notes: 'Este lugar. Deprocast recursivo.',
    contract: ipo(
      'El organismo entero.',
      'Metaanálisis + IDA.',
      'Agentes y poderes que se mejoran a sí mismos.',
    ),
    agentIds: ['omnivoro-nucleo', 'sentinela'],
    typology: 'omnivoro',
  },
}

function defaultContract(index: number): DeproContract {
  const geo = powerGeometry(index)
  const dominio = DEPRO_DOMAIN_META[geo.domain].label
  const oficio = oficioLabel(geo)
  const hueco = `Hueco ${powerNumber(index)} · ${dominio} · ${oficio}.`
  return ipo(
    geo.ipo === 'input' ? hueco : `Todavía no hay contrato de entrada.`,
    geo.ipo === 'procesamiento' ? hueco : `Todavía no hay contrato de procesamiento.`,
    geo.ipo === 'output' ? hueco : `Todavía no hay contrato de salida.`,
  )
}

function agentsFor(index: number): string[] {
  return AGENT_CATALOG.filter((a) => a.powerIndexes.includes(index)).map(
    (a) => a.id,
  )
}

export const POWER_CATALOG: DeproPower[] = Array.from({ length: 72 }, (_, index) => {
  const geo = powerGeometry(index)
  const named = NAMED[index]
  const domainLabel = DEPRO_DOMAIN_META[geo.domain].label
  return {
    ...geo,
    name: named?.name ?? `Poder ${powerNumber(index)}`,
    status: named?.status ?? 'hueco',
    notes:
      named?.notes ??
      `${domainLabel} · ${oficioLabel(geo)}. Celda vacía: cargarla en código cuando toque.`,
    contract: named?.contract ?? defaultContract(index),
    agentIds: named?.agentIds ?? agentsFor(index),
    typology: named?.typology ?? geo.typology,
    operator_notes: '',
    status_override: null,
  }
})

export function powerByIndex(index: number): DeproPower {
  return POWER_CATALOG[((index % 72) + 72) % 72]
}

export function mergePowerOverlay(
  power: DeproPower,
  overlay: { notes: string; status: DeproPowerStatus | null } | undefined,
): DeproPower {
  if (!overlay) return power
  return {
    ...power,
    operator_notes: overlay.notes,
    status_override: overlay.status,
    status: overlay.status ?? power.status,
  }
}

export function powerEffectiveStatus(power: DeproPower): DeproPowerStatus {
  return power.status_override ?? power.status
}
