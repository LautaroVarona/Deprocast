import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDbFile } from '../server/db.ts'
import { seedAmazona } from '../server/services/amazonaSeed.ts'

describe('knowledge schema polimórfico', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
    dirs.length = 0
  })

  it('crea núcleo, satélites, FTS y seeds AmazonA', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'depro-know-'))
    dirs.push(dir)
    const database = openDbFile(path.join(dir, 't.db'), { seed: false })
    seedAmazona(database)

    const names = (
      database
        .prepare(
          `SELECT name FROM sqlite_master WHERE type IN ('table', 'index')`,
        )
        .all() as Array<{ name: string }>
    ).map((r) => r.name)

    for (const name of [
      'knowledge_entities',
      'knowledge_repos',
      'knowledge_papers',
      'knowledge_legal',
      'knowledge_books',
      'knowledge_anchors',
      'knowledge_fts',
    ]) {
      expect(names).toContain(name)
    }

    const now = new Date().toISOString()
    database
      .prepare(
        `INSERT INTO knowledge_entities (
          id, kind, title, authors_org, source_url, summary, utility_problem,
          architecture_tldr, use_cases, captured_at, status, capture_error,
          weight, distilled_at, domain_ids, tags, notes, capture_mode,
          created_at, updated_at
        ) VALUES (
          'k1', 'repo', 'whisper.cpp', 'ggerganov',
          'https://github.com/ggerganov/whisper.cpp',
          '', 'STT local', 'C++ / GGML', 'transcribir audio', ?, 'ready', NULL,
          NULL, NULL, '[]', '[]', '', 'url', ?, ?
        )`,
      )
      .run(now, now, now)
    database
      .prepare(
        `INSERT INTO knowledge_repos (entity_id, owner, repo_name, stack_tags, archived)
         VALUES ('k1', 'ggerganov', 'whisper.cpp', '["whisper"]', 0)`,
      )
      .run()

    expect(() =>
      database
        .prepare(
          `INSERT INTO knowledge_papers (entity_id, doi, abstract)
           VALUES ('missing-parent', NULL, '')`,
        )
        .run(),
    ).toThrow()

    const fts = database
      .prepare(
        `SELECT title FROM knowledge_fts WHERE knowledge_fts MATCH 'whisper'`,
      )
      .get() as { title: string } | undefined
    expect(fts?.title).toBe('whisper.cpp')

    const seeds = (
      database
        .prepare(
          `SELECT id FROM ama_lists WHERE id IN (
            'ama-lista6-conocimiento-fuentes',
            'ama-lista6-conocimiento-vectores',
            'ama-lista6-conocimiento-saber'
          )`,
        )
        .all() as Array<{ id: string }>
    ).map((r) => r.id)
    expect(seeds).toHaveLength(3)

    const matrices = (
      database
        .prepare(
          `SELECT id FROM ama_matrices WHERE id IN (
            'ama-matrix-conocimiento',
            'ama-matrix-intersecciones'
          )`,
        )
        .all() as Array<{ id: string }>
    ).map((r) => r.id)
    expect(matrices).toHaveLength(2)

    database.close()
  })
})
