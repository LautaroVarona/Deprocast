/**
 * Radiografía técnica de un referente: parse de GitHub, diccionario de stack y pulso.
 * Sin I/O de red. El fetch vive en knowledgeGithub.ts.
 */

export type KnowledgePulse = 'vivo' | 'tibio' | 'abandonado'

export type GithubRepoRef = {
  owner: string
  repo: string
  url: string
}

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com'])

const PACKAGE_TAGS: Record<string, string> = {
  next: 'nextjs',
  'next.js': 'nextjs',
  react: 'react',
  'react-dom': 'react',
  vue: 'vue',
  nuxt: 'vue',
  svelte: 'svelte',
  '@sveltejs/kit': 'svelte',
  '@angular/core': 'angular',
  tailwindcss: 'tailwind',
  vite: 'vite',
  electron: 'electron',
  tauri: 'tauri',
  '@tauri-apps/api': 'tauri',
  typescript: 'typescript',
  'fluent-ffmpeg': 'ffmpeg',
  'ffmpeg-static': 'ffmpeg',
  '@ffmpeg/ffmpeg': 'ffmpeg',
  'openai-whisper': 'whisper',
  whisper: 'whisper',
  'better-sqlite3': 'sqlite',
  sqlite3: 'sqlite',
  postgres: 'postgres',
  pg: 'postgres',
  mongodb: 'mongodb',
  mongoose: 'mongodb',
  graphql: 'graphql',
  express: 'node',
  fastify: 'node',
  hono: 'node',
  torch: 'pytorch',
  tensorflow: 'tensorflow',
  fastapi: 'fastapi',
  django: 'django',
  flask: 'flask',
}

const PY_TAGS: Record<string, string> = {
  'openai-whisper': 'whisper',
  whisper: 'whisper',
  'faster-whisper': 'whisper',
  torch: 'pytorch',
  pytorch: 'pytorch',
  tensorflow: 'tensorflow',
  fastapi: 'fastapi',
  django: 'django',
  flask: 'flask',
  ffmpeg: 'ffmpeg',
  'ffmpeg-python': 'ffmpeg',
  numpy: 'python',
  pandas: 'python',
}

const YEAR_MS = 365.25 * 24 * 3600 * 1000

export function parseGithubRepoRef(input: string): GithubRepoRef | null {
  const raw = input.trim()
  if (!raw) return null

  const nwo = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/)
  if (nwo && !raw.includes('://') && !raw.includes('github.com')) {
    return packRef(nwo[1]!, nwo[2]!)
  }

  let url: URL
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  if (!GITHUB_HOSTS.has(host)) return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 2) return null
  const owner = parts[0]!
  let repo = parts[1]!.replace(/\.git$/i, '')
  if (!owner || !repo) return null
  if (
    ['orgs', 'users', 'settings', 'marketplace', 'topics', 'features'].includes(
      owner.toLowerCase(),
    )
  ) {
    return null
  }
  return packRef(owner, repo)
}

function packRef(owner: string, repo: string): GithubRepoRef | null {
  if (!/^[A-Za-z0-9_.-]+$/.test(owner)) return null
  if (!/^[A-Za-z0-9_.-]+$/.test(repo)) return null
  if (owner === '.' || repo === '.' || owner === '..' || repo === '..') return null
  return {
    owner,
    repo,
    url: `https://github.com/${owner}/${repo}`,
  }
}

export function normalizeGithubUrl(input: string): string | null {
  return parseGithubRepoRef(input)?.url ?? null
}

export type StackEvidence = {
  files?: Record<string, string>
  topics?: string[]
  languages?: Record<string, number>
  readme?: string
}

export function detectStackTags(evidence: StackEvidence): string[] {
  const tags = new Set<string>()
  const files = evidence.files ?? {}

  for (const [filename, text] of Object.entries(files)) {
    const lower = filename.replace(/\\/g, '/').toLowerCase()
    if (lower.endsWith('package.json')) scanPackageJson(text, tags)
    else if (lower.endsWith('requirements.txt') || lower.endsWith('pipfile')) {
      scanPythonReqs(text, tags)
    } else if (lower.endsWith('pyproject.toml')) scanPyproject(text, tags)
    else if (lower.endsWith('go.mod')) {
      tags.add('go')
    } else if (lower.endsWith('cargo.toml')) {
      tags.add('rust')
      if (/ffmpeg/i.test(text)) tags.add('ffmpeg')
      if (/whisper/i.test(text)) tags.add('whisper')
    } else if (/dockerfile$/i.test(lower) || /docker-compose/i.test(lower)) {
      tags.add('docker')
      if (/ffmpeg/i.test(text)) tags.add('ffmpeg')
      if (/whisper/i.test(text)) tags.add('whisper')
    } else if (/makefile$/i.test(lower)) {
      if (/ffmpeg/i.test(text)) tags.add('ffmpeg')
      if (/whisper/i.test(text)) tags.add('whisper')
    } else if (lower.endsWith('gemfile')) tags.add('ruby')
    else if (lower.endsWith('composer.json')) tags.add('php')
    else if (/\.(csproj|fsproj|vbproj)$/i.test(lower)) tags.add('csharp')
    else if (/pom\.xml$/i.test(lower) || /build\.gradle/i.test(lower)) {
      tags.add('java')
    }
  }

  for (const topic of evidence.topics ?? []) {
    const t = topic.toLowerCase().replace(/\s+/g, '')
    if (t.includes('nextjs') || t === 'next.js') tags.add('nextjs')
    if (t.includes('tailwind')) tags.add('tailwind')
    if (t.includes('ffmpeg')) tags.add('ffmpeg')
    if (t.includes('whisper')) tags.add('whisper')
    if (t.includes('react')) tags.add('react')
    if (t.includes('python')) tags.add('python')
    if (t.includes('rust')) tags.add('rust')
    if (t.includes('docker')) tags.add('docker')
  }

  const langs = Object.keys(evidence.languages ?? {}).map((k) => k.toLowerCase())
  if (langs.includes('typescript') || langs.includes('javascript')) tags.add('node')
  if (langs.includes('python')) tags.add('python')
  if (langs.includes('rust')) tags.add('rust')
  if (langs.includes('go')) tags.add('go')
  if (langs.includes('java')) tags.add('java')
  if (langs.includes('c#') || langs.includes('c-sharp')) tags.add('csharp')
  if (langs.includes('php')) tags.add('php')
  if (langs.includes('ruby')) tags.add('ruby')

  const readme = evidence.readme ?? ''
  if (readme) {
    if (/\bffmpeg\b/i.test(readme)) tags.add('ffmpeg')
    if (/\bwhisper\b/i.test(readme)) tags.add('whisper')
    if (/\bnext\.js\b|\bnextjs\b/i.test(readme) && !tags.has('nextjs')) {
      tags.add('nextjs')
    }
    if (/\btailwind\b/i.test(readme)) tags.add('tailwind')
  }

  return [...tags].sort()
}

function scanPackageJson(text: string, tags: Set<string>): void {
  tags.add('node')
  try {
    const parsed = JSON.parse(text) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }
    const names = {
      ...parsed.dependencies,
      ...parsed.devDependencies,
      ...parsed.optionalDependencies,
    }
    for (const name of Object.keys(names)) {
      const mapped = PACKAGE_TAGS[name.toLowerCase()]
      if (mapped) tags.add(mapped)
      if (/whisper/i.test(name)) tags.add('whisper')
      if (/ffmpeg/i.test(name)) tags.add('ffmpeg')
    }
  } catch {
    if (/next/i.test(text)) tags.add('nextjs')
    if (/tailwind/i.test(text)) tags.add('tailwind')
    if (/ffmpeg/i.test(text)) tags.add('ffmpeg')
    if (/whisper/i.test(text)) tags.add('whisper')
  }
}

function scanPythonReqs(text: string, tags: Set<string>): void {
  tags.add('python')
  for (const line of text.split(/\r?\n/)) {
    const name = line
      .trim()
      .replace(/\s+#.*$/, '')
      .split(/[=<>!~\[]/)[0]
      ?.trim()
      .toLowerCase()
    if (!name) continue
    const mapped = PY_TAGS[name]
    if (mapped) tags.add(mapped)
    if (name.includes('whisper')) tags.add('whisper')
    if (name.includes('ffmpeg')) tags.add('ffmpeg')
  }
}

function scanPyproject(text: string, tags: Set<string>): void {
  tags.add('python')
  if (/fastapi/i.test(text)) tags.add('fastapi')
  if (/django/i.test(text)) tags.add('django')
  if (/whisper/i.test(text)) tags.add('whisper')
  if (/ffmpeg/i.test(text)) tags.add('ffmpeg')
  if (/torch|pytorch/i.test(text)) tags.add('pytorch')
}

export function pulseFromRepo(input: {
  archived?: number | boolean | null
  last_commit_at?: string | null
  pushed_at?: string | null
  now?: number
}): KnowledgePulse {
  if (input.archived === 1 || input.archived === true) return 'abandonado'
  const at = input.last_commit_at || input.pushed_at
  if (!at) return 'tibio'
  const ts = Date.parse(at)
  if (Number.isNaN(ts)) return 'tibio'
  const age = (input.now ?? Date.now()) - ts
  if (age > 3 * YEAR_MS) return 'abandonado'
  if (age > YEAR_MS) return 'tibio'
  return 'vivo'
}

export function stripReadmeChrome(markdown: string): string {
  const withoutHtmlComments = markdown.replace(/<!--[\s\S]*?-->/g, '')
  const withoutImgs = withoutHtmlComments
    .replace(/\[!\[[^\]]*]\([^)]*\)\]\([^)]*\)/g, '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<p\s+align=["'][^"']*["']>\s*<\/p>/gi, '')
  return withoutImgs.replace(/\n{3,}/g, '\n\n').trim()
}
