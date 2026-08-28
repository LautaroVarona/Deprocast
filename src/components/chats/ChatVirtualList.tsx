import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

type Props<T> = {
  items: T[]
  estimate?: number
  className?: string
  renderItem: (item: T, index: number) => ReactNode
}

/** Lista virtual sin dependencias extra. Debajo de 36 ítems renderiza todo. */
export function ChatVirtualList<T>({
  items,
  estimate = 76,
  className,
  renderItem,
}: Props<T>) {
  const ref = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(0)
  const [h, setH] = useState(480)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const apply = () => setH(el.clientHeight || 480)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (items.length < 36) {
    return (
      <div ref={ref} className={className}>
        {items.map((item, i) => renderItem(item, i))}
      </div>
    )
  }

  const start = Math.max(0, Math.floor(top / estimate) - 5)
  const visible = Math.ceil(h / estimate) + 10
  const end = Math.min(items.length, start + visible)

  return (
    <div
      ref={ref}
      className={className}
      onScroll={(e) => setTop(e.currentTarget.scrollTop)}
    >
      <div
        style={{
          height: items.length * estimate,
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: start * estimate,
            left: 0,
            right: 0,
          }}
        >
          {items.slice(start, end).map((item, i) =>
            renderItem(item, start + i),
          )}
        </div>
      </div>
    </div>
  )
}
