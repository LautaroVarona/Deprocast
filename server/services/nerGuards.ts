/**
 * Guardas NER: excluir autores de posts y refinar kind de personas.
 */
import {
  normalizePersonKind,
  type PersonKind,
} from './personKinds.js'

function normalizeName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripAt(raw: string): string {
  return raw.trim().replace(/^@+/, '')
}

/** Claves normalizadas para comparar un autor de bookmark/post. */
export function authorMatchKeys(
  authorName?: string | null,
  authorUsername?: string | null,
): Set<string> {
  const keys = new Set<string>()
  const name = String(authorName ?? '').trim()
  const user = stripAt(String(authorUsername ?? ''))
  if (name) {
    const n = normalizeName(name)
    if (n) keys.add(n)
    // "Nick Arner @nickarner" → solo la parte nombre
    const beforeAt = name.split('@')[0]?.trim()
    if (beforeAt) {
      const bn = normalizeName(beforeAt)
      if (bn) keys.add(bn)
    }
  }
  if (user) {
    const u = normalizeName(user)
    if (u) keys.add(u)
    keys.add(user.toLowerCase())
  }
  return keys
}

/** True si la mención NER es el autor del post (no una mención en el cuerpo). */
export function matchesSourceAuthor(
  entityName: string,
  authorName?: string | null,
  authorUsername?: string | null,
): boolean {
  const keys = authorMatchKeys(authorName, authorUsername)
  if (keys.size === 0) return false
  const raw = String(entityName ?? '').trim()
  if (!raw) return false

  const candidates = new Set<string>()
  const add = (s: string) => {
    const n = normalizeName(s)
    if (n) candidates.add(n)
    const stripped = normalizeName(stripAt(s))
    if (stripped) candidates.add(stripped)
    const lower = stripAt(s).toLowerCase()
    if (lower) candidates.add(lower)
  }

  add(raw)
  // "Nick Arner @nickarner" / "thermo @DionysianAgent"
  for (const part of raw.split(/[@|]/).map((p) => p.trim()).filter(Boolean)) {
    add(part)
  }
  // "Name (@handle)" residual
  const handleMatch = raw.match(/@([\w.]+)/)
  if (handleMatch?.[1]) add(handleMatch[1])

  for (const c of candidates) {
    if (keys.has(c)) return true
  }
  return false
}

export function filterSourceAuthorEntities<T extends { name: string }>(
  entities: T[],
  authorName?: string | null,
  authorUsername?: string | null,
): T[] {
  if (!authorName && !authorUsername) return entities
  return entities.filter(
    (e) => !matchesSourceAuthor(e.name, authorName, authorUsername),
  )
}

const JURIDICA_RE =
  /\b(inc|llc|ltd|gmbh|s\.?\s?a\.?|s\.?\s?l\.?|corp|corporation|company|co\.|fundaci[oó]n|foundation|university|universidad|institute|instituto|studios?|records|agency|agencia|museum|museo|labs?|limited|holdings?|group|grupo|assoc(?:iation)?|asociaci[oó]n|ong|ngo|club)\b/i

const FICTICIA_RE =
  /\b(character|personaje|fictional|fictici[oa]|avatar|npc|alter\s*ego)\b/i

/**
 * Sustantivos/adjetivos de categoría o dominio que el NER confunde con personas.
 * Personas de verdad son nombres propios (físicas / jurídicas / ficticias).
 */
const ABSTRACT_LEXICON = new Set(
  [
    'grafico',
    'grafica',
    'graficos',
    'graficas',
    'audiovisual',
    'audiovisuales',
    'fisico',
    'fisica',
    'fisicos',
    'fisicas',
    'economico',
    'economica',
    'economicos',
    'economicas',
    'juridico',
    'juridica',
    'juridicos',
    'juridicas',
    'digital',
    'digitales',
    'distribucion',
    'produccion',
    'guion',
    'rodaje',
    'concepto',
    'conceptos',
    'categoria',
    'categorias',
    'dominio',
    'dominios',
    'motor',
    'motores',
    'sistema',
    'sistemas',
    'proceso',
    'procesos',
    'metodo',
    'metodos',
    'tecnica',
    'tecnicas',
    'herramienta',
    'herramientas',
    'plataforma',
    'plataformas',
    'formato',
    'formatos',
    'contenido',
    'contenidos',
    'narrativa',
    'estrategia',
    'estrategias',
    'negocio',
    'negocios',
    'mercado',
    'mercados',
    'producto',
    'productos',
    'servicio',
    'servicios',
    'proyecto',
    'proyectos',
    'tarea',
    'tareas',
    'idea',
    'ideas',
    'tema',
    'temas',
    'eje',
    'ejes',
    'capa',
    'capas',
    'nivel',
    'niveles',
    'modulo',
    'modulos',
    'fase',
    'fases',
    'etapa',
    'etapas',
    'flujo',
    'flujos',
    'canal',
    'canales',
    'medio',
    'medios',
    'recurso',
    'recursos',
    'dato',
    'datos',
    'modelo',
    'modelos',
    'framework',
    'frameworks',
    'algoritmo',
    'algoritmos',
    'protocolo',
    'protocolos',
    'infraestructura',
    'arquitectura',
    'diseno',
    'disenos',
    'arte',
    'cultura',
    'politica',
    'politicas',
    'legal',
    'legales',
    'financiero',
    'financiera',
    'tecnologico',
    'tecnologica',
    'social',
    'sociales',
    'humano',
    'humana',
    'humanos',
    'humanas',
    'alguien',
    'nadie',
    'gente',
    'persona',
    'personas',
    'usuario',
    'usuarios',
    'cliente',
    'clientes',
    'equipo',
    'equipos',
    'informacion',
    'informaciones',
    'dimension',
    'dimensiones',
    'vector',
    'vectores',
    'membrana',
    'membranas',
    'atractor',
    'atractores',
    'campo',
    'campos',
    'nodo',
    'nodos',
    'grafo',
    'grafos',
    'red',
    'redes',
    'matriz',
    'matrices',
    'ciclo',
    'ciclos',
    'patron',
    'patrones',
    'estructura',
    'estructuras',
    'capa',
    'capas',
    'superficie',
    'superficies',
    'volumen',
    'volumenes',
    'espacio',
    'espacios',
    'tiempo',
    'tiempos',
    'energia',
    'fuerza',
    'fuerzas',
    'senal',
    'senales',
    'codigo',
    'codigos',
    'lenguaje',
    'lenguajes',
    'simbolo',
    'simbolos',
    'metafora',
    'metaforas',
    'analogia',
    'analogias',
    'principio',
    'principios',
    'ley',
    'leyes',
    'regla',
    'reglas',
    'norma',
    'normas',
    'valor',
    'valores',
    'variable',
    'variables',
    'parametro',
    'parametros',
    'funcion',
    'funciones',
    'operacion',
    'operaciones',
    'transformacion',
    'transformaciones',
    'interfaz',
    'interfaces',
    'vista',
    'vistas',
    'panel',
    'paneles',
    'seccion',
    'secciones',
    'modulo',
    'modulos',
  ].map((s) => normalizeName(s)),
)

/** Morfología típica de abstractos en español (un solo token). */
const ABSTRACT_MORPH_RE =
  /^(?:[a-z]+(?:cion|sion|miento|dad|tad|ismo|ura|ancia|encia|aje|eria))$/i

const GEO_LEXICON = new Set(
  [
    'calle',
    'avenida',
    'av',
    'ruta',
    'camino',
    'pasaje',
    'plaza',
    'plazoleta',
    'barrio',
    'colonia',
    'ciudad',
    'pueblo',
    'villa',
    'provincia',
    'departamento',
    'estado',
    'pais',
    'region',
    'zona',
    'distrito',
    'comuna',
    'municipio',
    'cerro',
    'monte',
    'playa',
    'costa',
    'puerto',
    'bahia',
    'rio',
    'arroyo',
    'laguna',
    'lago',
    'isla',
    'parque',
    'bosque',
    'valle',
    'sierra',
    'cordillera',
    'oceano',
    'mar',
    'golfo',
    'estrecho',
    'frontera',
    'capital',
    'centro',
    'norte',
    'sur',
    'este',
    'oeste',
    'oriente',
    'occidente',
  ].map((s) => normalizeName(s)),
)

const GEO_PHRASE_RE =
  /\b(calle|av\.?|avenida|ruta|camino|pasaje|plaza|barrio|ciudad|pueblo|villa|provincia|departamento|pa[ií]s|regi[oó]n|zona|distrito|cerro|playa|costa|puerto|bah[ií]a|r[ií]o|arroyo|isla|parque|montevideo|buenos\s*aires|cordoba|c[oó]rdoba|rosario|valencia|madrid|barcelona|lisboa|santiago|lima|bogot[aá]|mexico|m[eé]xico|brasil|argentina|uruguay|chile|paraguay|bolivia|espa[nñ]a|portugal|francia|italia|alemania|europa|america|am[eé]rica|asia|africa|áfrica)\b/i

function lexiconHit(norm: string, set: Set<string>): boolean {
  if (set.has(norm)) return true
  if (norm.endsWith('es') && norm.length > 4 && set.has(norm.slice(0, -2))) {
    return true
  }
  if (norm.endsWith('s') && norm.length > 3 && set.has(norm.slice(0, -1))) {
    return true
  }
  return false
}

function looksLikeAbstractConcept(name: string): boolean {
  const raw = String(name ?? '').trim()
  if (!raw) return false
  // Handles / orgs con @ no son conceptos abstractos
  if (/@/.test(raw)) return false
  // Multi-palabra con apariencia de nombre propio → persona
  const parts = raw.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    const properish = parts.filter((p) => /^[\p{Lu}]/u.test(p)).length
    if (properish >= 2) return false
  }

  const norm = normalizeName(raw)
  if (!norm) return false
  if (lexiconHit(norm, ABSTRACT_LEXICON)) return true

  // Un solo token con morfología de concepto (distribución, producción, …)
  if (!norm.includes(' ') && ABSTRACT_MORPH_RE.test(norm)) return true

  return false
}

export function looksLikeGeography(name: string): boolean {
  const raw = String(name ?? '').trim()
  if (!raw) return false
  if (/@/.test(raw)) return false
  if (GEO_PHRASE_RE.test(raw)) return true
  const norm = normalizeName(raw)
  if (!norm) return false
  // "Calle X", "Av. Y" ya cubiertos por GEO_PHRASE_RE
  // Token único que es tipo de lugar genérico → geografía (no persona)
  if (!norm.includes(' ') && lexiconHit(norm, GEO_LEXICON)) return true
  return false
}

/**
 * Refina kind de persona:
 * - eleva fisica → juridica/ficticia/geografia con señales léxicas
 * - baja a abstracta si es concepto/categoría/dominio (no una persona)
 * No toca abstracta/ruido ya marcados; no baja juridica/ficticia a fisica.
 */
export function refinePersonKind(
  name: string,
  kind: PersonKind | string | null | undefined,
): PersonKind {
  const base = normalizePersonKind(kind)
  const n = String(name ?? '').trim()
  if (!n) return base

  if (base === 'abstracta' || base === 'ruido') return base
  if (base === 'geografia') return 'geografia'

  if (JURIDICA_RE.test(n) || /[&]/.test(n)) {
    return 'juridica'
  }
  if (FICTICIA_RE.test(n)) {
    return 'ficticia'
  }

  // Handles sueltos (@marca) suelen ser marcas/orgs, no personas físicas
  if (/^@[\w.]+$/.test(n) && base === 'fisica') {
    return 'juridica'
  }

  // Lugares / topónimos → Geografía (antes caían en Personas o ruido)
  if (
    (base === 'fisica' || base === 'juridica') &&
    looksLikeGeography(n)
  ) {
    return 'geografia'
  }

  // Conceptos / taxonomías / roles genéricos ≠ Personas (físicas|jurídicas|ficticias)
  if (base === 'fisica' && looksLikeAbstractConcept(n)) {
    return 'abstracta'
  }

  return base
}
