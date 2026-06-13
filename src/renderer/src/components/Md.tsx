import type { JSX } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** Markdown renderer for assistant text and command output (tables, code, lists). */
export default function Md({ children }: { children: string }): JSX.Element {
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
