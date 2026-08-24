import type { AnatomySystem } from './types'

export const ANATOMY_SYSTEMS: Array<{
  id: AnatomySystem
  label: string
  hint: string
}> = [
  { id: 'nervous', label: 'Nervioso', hint: 'cerebro · neuronas · médula' },
  { id: 'cardiovascular', label: 'Cardiovascular', hint: 'corazón · vasos' },
  { id: 'endocrine', label: 'Endocrino', hint: 'glándulas · hormonas' },
  { id: 'respiratory', label: 'Respiratorio', hint: 'pulmones' },
  { id: 'digestive', label: 'Digestivo', hint: 'hígado · estómago' },
  { id: 'skeletal', label: 'Esquelético', hint: 'huesos · columna' },
  { id: 'lymphatic', label: 'Linfático', hint: 'nodos' },
  { id: 'integumentary', label: 'Integumentario', hint: 'piel / casco' },
]

export function defaultSystems(): Record<AnatomySystem, boolean> {
  return {
    nervous: true,
    cardiovascular: true,
    endocrine: true,
    respiratory: true,
    digestive: true,
    skeletal: true,
    lymphatic: true,
    integumentary: true,
  }
}
