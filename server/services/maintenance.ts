import { pausePipeline, waitPipelineIdle } from './pipeline.js'
import { stopBookmarkProcess, waitBookmarkIdle } from './bookmarkQueue.js'
import { pauseNotebookWork, resumeNotebookWork, waitNotebookIdle } from './notebookProcess.js'
import { pauseSourceProcessing, resumeSourceProcessing, waitSourceIdle } from './notebookSources.js'
import { abortResearchJobs, waitResearchIdle } from './research.js'

let generation = 0
let held = false

export function isMaintenanceHeld(): boolean {
  return held
}

export function maintenanceGeneration(): number {
  return generation
}

export async function beginMaintenance(reason: string): Promise<number> {
  generation += 1
  held = true
  console.warn(`[maintenance] begin gen=${generation} ${reason}`)
  pausePipeline()
  stopBookmarkProcess()
  pauseNotebookWork(reason)
  pauseSourceProcessing()
  abortResearchJobs()
  await Promise.all([
    waitPipelineIdle(20_000),
    waitBookmarkIdle(20_000),
    waitNotebookIdle(20_000),
    waitSourceIdle(20_000),
    waitResearchIdle(20_000),
  ])
  return generation
}

export function endMaintenance(gen: number): void {
  if (gen !== generation) return
  held = false
  resumeNotebookWork()
  resumeSourceProcessing()
  console.warn(`[maintenance] end gen=${generation}`)
}

export async function withMaintenance<T>(
  reason: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const gen = await beginMaintenance(reason)
  try {
    return await fn()
  } finally {
    endMaintenance(gen)
  }
}
