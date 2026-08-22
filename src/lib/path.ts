import { useEffect, useState } from 'react'

export function navigate(to: string): void {
  if (window.location.pathname === to) return
  window.history.pushState({}, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function usePathname(): string {
  const [path, setPath] = useState(() =>
    typeof window === 'undefined' ? '/' : window.location.pathname,
  )

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  return path
}

export function isDeprocastPath(path: string): boolean {
  return path === '/deprocast' || path.startsWith('/deprocast/')
}

export type DeprocastTab = 'matrix' | 'agentes' | 'ida'

export function deprocastTab(path: string): DeprocastTab {
  if (path.startsWith('/deprocast/agentes')) return 'agentes'
  if (path.startsWith('/deprocast/ida')) return 'ida'
  return 'matrix'
}

export function deprocastHref(tab: DeprocastTab): string {
  if (tab === 'agentes') return '/deprocast/agentes'
  if (tab === 'ida') return '/deprocast/ida'
  return '/deprocast'
}
