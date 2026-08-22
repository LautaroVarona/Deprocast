import type { DatabaseSync } from 'node:sqlite'
import type { DeproIdaStage } from '../types.js'

const IDA_SEED: Array<{
  id: string
  title: string
  body: string
  stage: DeproIdaStage
  power_indexes: number[]
  agent_ids: string[]
  tags: string[]
}> = [
  {
    id: 'depro-ida-omnivoro',
    title: 'Omnívoro: este núcleo',
    body: 'La sección /deprocast existe. Catálogo 72, agentes e IDA. Siguiente: que el Omnívoro ejecute (Cohere) y no solo cataloge.',
    stage: 'aplicacion',
    power_indexes: [71],
    agent_ids: ['omnivoro-nucleo'],
    tags: ['nucleo', 'recursivo'],
  },
  {
    id: 'depro-ida-auto-peso',
    title: 'Peso automático en Aduana',
    body: 'Sugerir peso 1–12 a partir del audio + transcript. El operador confirma. Hoy es 100% manual.',
    stage: 'investigacion',
    power_indexes: [12],
    agent_ids: ['auto-peso', 'aduanero'],
    tags: ['aduana', 'audio', 'criba'],
  },
  {
    id: 'depro-ida-diarizador',
    title: 'Match speaker → persona',
    body: 'Deepgram ya diariza. Falta sugerir la persona del roster y prellenar la criba.',
    stage: 'desarrollo',
    power_indexes: [9],
    agent_ids: ['diarizador'],
    tags: ['audio', 'aduana'],
  },
  {
    id: 'depro-ida-media-enrich',
    title: 'Enrich de reels',
    body: 'Frames → Vision → ocr_json para bookmarks de peso alto. Parcialmente cableado.',
    stage: 'desarrollo',
    power_indexes: [13],
    agent_ids: ['media-enrich', 'cribador'],
    tags: ['criba', 'vision'],
  },
  {
    id: 'depro-ida-link-crawler',
    title: 'Crawler de links',
    body: 'link_harvest existe. Cerrar el fetch + summarize + embed.',
    stage: 'investigacion',
    power_indexes: [31],
    agent_ids: ['link-crawler', 'mnemosyne'],
    tags: ['memoria', 'crawler'],
  },
  {
    id: 'depro-ida-explorador',
    title: 'Explorador / cuarentena Perplexity',
    body: 'Puente manual: Generar Prompt 6×6 → Perplexity Pro → pegar JSON → cuarentena HITL → aprendizajes + embed. La API Sonar queda para después.',
    stage: 'aplicacion',
    power_indexes: [33],
    agent_ids: ['explorador', 'explorador-academico', 'explorador-mercado'],
    tags: ['memoria', 'research', 'perplexity'],
  },
  {
    id: 'depro-ida-chronos',
    title: 'Chronos: sugerir slots',
    body: 'El calendario muestra. Todavía no prioriza ni propone huecos del día.',
    stage: 'investigacion',
    power_indexes: [36],
    agent_ids: ['cronista'],
    tags: ['calendario', 'territorio'],
  },
  {
    id: 'depro-ida-campo-dia',
    title: 'AmazonA: celdas del día',
    body: 'Proponer notas de celda según el ciclo ayer/hoy/mañana y la RUN.',
    stage: 'investigacion',
    power_indexes: [40],
    agent_ids: ['campo'],
    tags: ['amazona'],
  },
  {
    id: 'depro-ida-contable',
    title: 'Agente contable',
    body: 'Dominio Finanzas vacío. Empezar por Haber: hechos económicos → libro mayor.',
    stage: 'investigacion',
    power_indexes: [45, 48],
    agent_ids: ['contable'],
    tags: ['finanzas'],
  },
  {
    id: 'depro-ida-legista',
    title: 'Legista',
    body: 'Archivo normativo y fichas jurídicas. No dictamen: tematizar fuero, partes, plazos.',
    stage: 'investigacion',
    power_indexes: [54, 57],
    agent_ids: ['legista'],
    tags: ['derecho'],
  },
  {
    id: 'depro-ida-vitalidad',
    title: 'Nutrición / carga',
    body: 'Soma, Entrenador y Mesa. El calendario ya tiene Cuerpo; falta el agente.',
    stage: 'investigacion',
    power_indexes: [63, 67, 70],
    agent_ids: ['entrenador', 'nutricionista', 'soma'],
    tags: ['vitalidad', 'cuerpo'],
  },
  {
    id: 'depro-ida-feedback',
    title: 'Triage de feedback',
    body: 'El widget guarda notas. Un agente que las agrupe y las convierta en fichas IDA.',
    stage: 'investigacion',
    power_indexes: [71],
    agent_ids: ['omnivoro-nucleo'],
    tags: ['feedback', 'nucleo'],
  },
]

export function seedDeprocast(db: DatabaseSync): void {
  const now = new Date().toISOString()
  const insert = db.prepare(
    `INSERT INTO depro_ida_items (
      id, title, body, stage, power_indexes, agent_ids, tags, domain_ids,
      origin, archived, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'seed', 0, ?, ?)`,
  )
  const exists = db.prepare('SELECT id FROM depro_ida_items WHERE id = ?')
  const domainByTag: Record<string, string> = {
    finanzas: 'dom-finanzas',
    derecho: 'dom-derecho',
    vitalidad: 'dom-salud',
    cuerpo: 'dom-salud',
  }
  for (const item of IDA_SEED) {
    const found = exists.get(item.id) as { id: string } | undefined
    if (found) continue
    const domainIds = [
      ...new Set(
        item.tags
          .map((t) => domainByTag[t])
          .filter((x): x is string => Boolean(x)),
      ),
    ]
    insert.run(
      item.id,
      item.title,
      item.body,
      item.stage,
      JSON.stringify(item.power_indexes),
      JSON.stringify(item.agent_ids),
      JSON.stringify(item.tags),
      JSON.stringify(domainIds),
      now,
      now,
    )
  }
}
