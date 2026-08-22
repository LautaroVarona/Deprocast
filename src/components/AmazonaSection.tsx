import { useCallback, useEffect, useState } from 'react'
import { api } from '../services/api'
import type { AmaOverview, AmaPlace } from '../types'
import { AmazonaCampo } from './amazona/AmazonaCampo'
import { AmazonaCiclo } from './amazona/AmazonaCiclo'
import { AmazonaGeo } from './amazona/AmazonaGeo'
import { AmazonaListas } from './amazona/AmazonaListas'

type Tab = 'campo' | 'listas' | 'geo' | 'ciclo'

type Props = {
  refreshKey: number
  onChanged?: () => void
}

export function AmazonaSection({ refreshKey, onChanged }: Props) {
  const [tab, setTab] = useState<Tab>('campo')
  const [overview, setOverview] = useState<AmaOverview | null>(null)
  const [places, setPlaces] = useState<AmaPlace[]>([])

  const loadMeta = useCallback(async () => {
    try {
      const [ov, pl] = await Promise.all([
        api.amazonaOverview(),
        api.amazonaListPlaces(),
      ])
      setOverview(ov.overview)
      setPlaces(pl.places)
    } catch {
      /* keep */
    }
  }, [])

  useEffect(() => {
    void loadMeta()
  }, [loadMeta, refreshKey])

  const bump = () => {
    void loadMeta()
    onChanged?.()
  }

  return (
    <div className="ama-stage entity-stage">
      <div className="personas-mode-switch" role="tablist" aria-label="AmazonA">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'campo'}
          className={tab === 'campo' ? 'filter-chip is-active' : 'filter-chip'}
          onClick={() => setTab('campo')}
        >
          Campo
          {overview && overview.matrices6 > 0 ? (
            <span className="nav-badge">{overview.matrices6}</span>
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'listas'}
          className={tab === 'listas' ? 'filter-chip is-active' : 'filter-chip'}
          onClick={() => setTab('listas')}
        >
          Listas
          {overview && overview.lists > 0 ? (
            <span className="nav-badge">{overview.lists}</span>
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'geo'}
          className={tab === 'geo' ? 'filter-chip is-active' : 'filter-chip'}
          onClick={() => setTab('geo')}
        >
          Geografía
          {overview && overview.places > 0 ? (
            <span className="nav-badge">{overview.places}</span>
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'ciclo'}
          className={tab === 'ciclo' ? 'filter-chip is-active' : 'filter-chip'}
          onClick={() => setTab('ciclo')}
        >
          Ciclo
        </button>
      </div>

      {tab === 'campo' ? (
        <AmazonaCampo
          refreshKey={refreshKey}
          places={places}
          onChanged={bump}
        />
      ) : null}
      {tab === 'listas' ? (
        <AmazonaListas
          refreshKey={refreshKey}
          places={places}
          onChanged={bump}
        />
      ) : null}
      {tab === 'geo' ? (
        <AmazonaGeo refreshKey={refreshKey} onChanged={bump} />
      ) : null}
      {tab === 'ciclo' ? (
        <AmazonaCiclo
          refreshKey={refreshKey}
          places={places}
          onChanged={bump}
        />
      ) : null}
    </div>
  )
}
