import { UniverseEngine } from '../../aleph/UniverseEngine'
import { AlephHud } from '../../aleph/hud/AlephHud'

export function AlephSection() {
  return (
    <div className="aleph-workspace">
      <div className="aleph-canvas">
        <UniverseEngine />
      </div>
      <AlephHud />
    </div>
  )
}
