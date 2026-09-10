/**
 * Cliente GitHub REST. Sin scrape HTML. Token opcional (60 req/h sin él).
 */
import { parseGithubRepoRef, type GithubRepoRef } from './knowledgeStack.js'
import { AppError } from '../errors.js'

export type GithubRepoMeta = {
  owner: string
  repo: string
  html_url: string
  description: string
  default_branch: string | null
  license: string | null
  topics: string[]
  language: string | null
  languages: Record<string, number>
  stars: number
  open_issues: number
  archived: boolean
  pushed_at: string | null
  last_commit_at: string | null
  last_commit_sha: string | null
  last_commit_message: string | null
  readme: string
  files: Record<string, string>
}

const MANIFEST_PATHS = [
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'Pipfile',
  'go.mod',
  'Cargo.toml',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'Makefile',
  'Gemfile',
  'composer.json',
]

function env(key: string): string {
  return (process.env[key] ?? '').replace(/^["']|["']$/g, '').trim()
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Deprocast-knowledge',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const token = env('GITHUB_TOKEN')
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function githubGet(path: string): Promise<{
  status: number
  json: unknown
  text: string
}> {
  const url = `https://api.github.com${path}`
  let res: Response
  try {
    res = await fetch(url, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new AppError(`GitHub no responde: ${msg.slice(0, 180)}`, 502, 'GITHUB_UNAVAILABLE')
  }
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: res.status, json, text }
}

function decodeContent(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const o = payload as { encoding?: string; content?: string; size?: number }
  if (typeof o.size === 'number' && o.size > 250_000) return null
  if (typeof o.content !== 'string') return null
  try {
    return Buffer.from(o.content.replace(/\n/g, ''), 'base64').toString('utf8')
  } catch {
    return null
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

export async function fetchGithubRepo(input: string): Promise<GithubRepoMeta> {
  const ref = parseGithubRepoRef(input)
  if (!ref) {
    throw new AppError('URL de GitHub inválida', 400, 'GITHUB_URL')
  }
  return fetchGithubRepoRef(ref)
}

export async function fetchGithubRepoRef(ref: GithubRepoRef): Promise<GithubRepoMeta> {
  const repoRes = await githubGet(`/repos/${ref.owner}/${ref.repo}`)
  if (repoRes.status === 404) {
    throw new AppError('Repo no encontrado en GitHub', 404, 'GITHUB_NOT_FOUND')
  }
  if (repoRes.status === 403 || repoRes.status === 429) {
    throw new AppError(
      'GitHub recortó el cupo. Poné GITHUB_TOKEN en .env.',
      429,
      'GITHUB_RATE',
    )
  }
  if (repoRes.status >= 400) {
    throw new AppError(
      `GitHub ${repoRes.status}: ${repoRes.text.slice(0, 180)}`,
      502,
      'GITHUB_ERROR',
    )
  }
  const repo = asRecord(repoRes.json)
  if (!repo) throw new AppError('Respuesta GitHub vacía', 502, 'GITHUB_ERROR')

  const ownerObj = asRecord(repo.owner)
  const licenseObj = asRecord(repo.license)
  const owner =
    (typeof ownerObj?.login === 'string' && ownerObj.login) || ref.owner
  const name = (typeof repo.name === 'string' && repo.name) || ref.repo
  const topics = Array.isArray(repo.topics)
    ? repo.topics.filter((t): t is string => typeof t === 'string')
    : []

  const [langRes, commitRes, readmeRes] = await Promise.all([
    githubGet(`/repos/${ref.owner}/${ref.repo}/languages`),
    githubGet(`/repos/${ref.owner}/${ref.repo}/commits?per_page=1`),
    githubGet(`/repos/${ref.owner}/${ref.repo}/readme`),
  ])

  const languages =
    langRes.status === 200 && asRecord(langRes.json)
      ? Object.fromEntries(
          Object.entries(asRecord(langRes.json)!).filter(
            (e): e is [string, number] => typeof e[1] === 'number',
          ),
        )
      : {}

  let last_commit_at: string | null = null
  let last_commit_sha: string | null = null
  let last_commit_message: string | null = null
  if (commitRes.status === 200 && Array.isArray(commitRes.json) && commitRes.json[0]) {
    const c = asRecord(commitRes.json[0])
    const commit = asRecord(c?.commit)
    const author = asRecord(commit?.author) ?? asRecord(commit?.committer)
    last_commit_at =
      typeof author?.date === 'string' ? author.date : null
    last_commit_sha = typeof c?.sha === 'string' ? c.sha : null
    last_commit_message =
      typeof commit?.message === 'string' ? commit.message.split('\n')[0] ?? null : null
  }

  const readme = readmeRes.status === 200 ? decodeContent(readmeRes.json) ?? '' : ''

  const files: Record<string, string> = {}
  const chunkSize = 4
  for (let i = 0; i < MANIFEST_PATHS.length; i += chunkSize) {
    const chunk = MANIFEST_PATHS.slice(i, i + chunkSize)
    const results = await Promise.all(
      chunk.map((p) =>
        githubGet(
          `/repos/${ref.owner}/${ref.repo}/contents/${encodeURIComponent(p)}`,
        ).then((fileRes) => ({ p, fileRes })),
      ),
    )
    for (const { p, fileRes } of results) {
      if (fileRes.status !== 200) continue
      const decoded = decodeContent(fileRes.json)
      if (decoded) files[p] = decoded
    }
  }

  return {
    owner,
    repo: name,
    html_url:
      typeof repo.html_url === 'string'
        ? repo.html_url
        : `https://github.com/${owner}/${name}`,
    description: typeof repo.description === 'string' ? repo.description : '',
    default_branch:
      typeof repo.default_branch === 'string' ? repo.default_branch : null,
    license:
      typeof licenseObj?.spdx_id === 'string' ? licenseObj.spdx_id : null,
    topics,
    language: typeof repo.language === 'string' ? repo.language : null,
    languages,
    stars: Number(repo.stargazers_count ?? 0) || 0,
    open_issues: Number(repo.open_issues_count ?? 0) || 0,
    archived: Boolean(repo.archived),
    pushed_at: typeof repo.pushed_at === 'string' ? repo.pushed_at : null,
    last_commit_at,
    last_commit_sha,
    last_commit_message,
    readme,
    files,
  }
}
