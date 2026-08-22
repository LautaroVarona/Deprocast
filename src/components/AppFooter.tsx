import { navigate } from '../lib/path'

export function AppFooter() {
  return (
    <footer className="app-footer">
      <a
        href="/deprocast"
        className="app-footer-nucleo"
        aria-label="Núcleo Deprocast"
        onClick={(e) => {
          e.preventDefault()
          navigate('/deprocast')
        }}
      >
        ◇ núcleo
      </a>
    </footer>
  )
}
