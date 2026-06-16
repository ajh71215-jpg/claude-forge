import { memo, type JSX } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Markdown renderer for assistant text and command output (tables, code, lists).
 * Memoized: react-markdown has no incremental parse, so re-rendering with an
 * unchanged string would re-parse the whole document. memo skips that — a
 * completed block keeps the same text and is never re-parsed on later renders.
 * See docs/PERFORMANCE.md (lever 1).
 */
function Md({ children }: { children: string }): JSX.Element {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Render links as plain text spans — navigation is handled by the
          // main process' window-open handler, and we don't want in-app nav.
          a: ({ children }) => <span className="md-link">{children}</span>
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

export default memo(Md)
