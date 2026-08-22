import type { DeproIdaKind } from '../../types'

export type IdaDraft = {
  title: string
  body?: string
  power_indexes?: number[]
  agent_ids?: string[]
  tags?: string[]
  kind?: DeproIdaKind
  row_item_id?: string
  col_item_id?: string
  weight?: number
  domain_ids?: string[]
}
