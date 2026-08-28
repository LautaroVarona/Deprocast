import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type Props = {
  children: string
  className?: string
}

export function SentinelMarkdown({ children, className = '' }: Props) {
  const source = children.trim()
  if (!source) return null

  return (
    <div
      className={`sentinel-md prose prose-invert max-w-none ${className}`.trim()}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
    </div>
  )
}
