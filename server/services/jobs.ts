import { randomUUID } from 'node:crypto'
import { getDb } from '../db.js'
import { rows } from '../sql.js'

export type JobFamily =
  | 'pipeline'
  | 'bookmark'
  | 'notebook_vision'
  | 'notebook_source'
  | 'research'

export type JobStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'error'
  | 'cancelled'
  | 'dead'

export type JobRow = {
  id: string
  family: JobFamily
  payload: string
  status: JobStatus
  owner: string | null
  generation: number
  attempts: number
  last_error: string | null
  run_after: string | null
  created_at: string
  updated_at: string
  finished_at: string | null
}

const OWNER = `pid-${process.pid}`

export function enqueueJob(family: JobFamily, payload: unknown): string {
  const id = randomUUID()
  const at = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO app_jobs (
        id, family, payload, status, owner, generation, attempts,
        last_error, run_after, created_at, updated_at, finished_at
      ) VALUES (?, ?, ?, 'queued', NULL, 0, 0, NULL, NULL, ?, ?, NULL)`,
    )
    .run(id, family, JSON.stringify(payload ?? {}), at, at)
  return id
}

export function claimQueuedJobs(family: JobFamily, limit = 20): JobRow[] {
  const db = getDb()
  const now = new Date().toISOString()
  const found = rows<JobRow>(
    db
      .prepare(
        `SELECT * FROM app_jobs
         WHERE family = ?
           AND status IN ('queued', 'running')
           AND (run_after IS NULL OR run_after <= ?)
         ORDER BY created_at ASC
         LIMIT ?`,
      )
      .all(family, now, limit),
  )
  const claimed: JobRow[] = []
  for (const job of found) {
    const gen = job.generation + 1
    const result = db
      .prepare(
        `UPDATE app_jobs
         SET status = 'running', owner = ?, generation = ?, updated_at = ?
         WHERE id = ? AND generation = ? AND status IN ('queued', 'running')`,
      )
      .run(OWNER, gen, now, job.id, job.generation)
    if (result.changes === 1) {
      claimed.push({ ...job, status: 'running', owner: OWNER, generation: gen })
    }
  }
  return claimed
}

export function finishJob(
  id: string,
  generation: number,
  status: Exclude<JobStatus, 'queued' | 'running'>,
  error?: string,
): boolean {
  const at = new Date().toISOString()
  const result = getDb()
    .prepare(
      `UPDATE app_jobs
       SET status = ?, last_error = ?, finished_at = ?, updated_at = ?, owner = NULL
       WHERE id = ? AND generation = ? AND status = 'running'`,
    )
    .run(status, error ?? null, at, at, id, generation)
  return result.changes === 1
}

export function retryJob(id: string, backoffMs: number, error: string): void {
  const at = new Date().toISOString()
  const runAfter = new Date(Date.now() + backoffMs).toISOString()
  getDb()
    .prepare(
      `UPDATE app_jobs
       SET status = CASE WHEN attempts >= 8 THEN 'dead' ELSE 'queued' END,
           attempts = attempts + 1,
           last_error = ?,
           run_after = ?,
           owner = NULL,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(error, runAfter, at, id)
}

export function recoverExpiredLeases(maxAgeMs = 120_000): number {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString()
  const result = getDb()
    .prepare(
      `UPDATE app_jobs
       SET status = 'queued', owner = NULL, updated_at = ?
       WHERE status = 'running' AND updated_at < ?`,
    )
    .run(new Date().toISOString(), cutoff)
  return Number(result.changes ?? 0)
}

export function listDeadJobs(limit = 50): JobRow[] {
  return rows<JobRow>(
    getDb()
      .prepare(
        `SELECT * FROM app_jobs WHERE status = 'dead' ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(limit),
  )
}

export function cancelJob(id: string): boolean {
  const result = getDb()
    .prepare(
      `UPDATE app_jobs SET status = 'cancelled', owner = NULL, updated_at = ?
       WHERE id = ? AND status IN ('queued', 'running')`,
    )
    .run(new Date().toISOString(), id)
  return result.changes === 1
}

export function requeueDead(id: string): boolean {
  const result = getDb()
    .prepare(
      `UPDATE app_jobs
       SET status = 'queued', attempts = 0, run_after = NULL, last_error = NULL, updated_at = ?
       WHERE id = ? AND status = 'dead'`,
    )
    .run(new Date().toISOString(), id)
  return result.changes === 1
}
