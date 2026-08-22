import { cellToParent, isValidCell } from 'h3-js'
import { H3_RES_REGIONAL } from './zones'

export function parentHex(hex: string, res = H3_RES_REGIONAL): string | null {
  if (!isValidCell(hex)) return null
  try {
    return cellToParent(hex, res)
  } catch {
    return null
  }
}
