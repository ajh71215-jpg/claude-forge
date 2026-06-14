// Tool-permission approval modal (docs/MAINTAINABILITY.md Phase 2). Extracted
// verbatim from App.tsx — behavior-preserving.
import type { JSX } from 'react'
import type { PermReq } from '../../types'
import { permArg, toolIcon } from '../../lib/format'

export default function PermissionModal({
  req,
  onResolve
}: {
  req: PermReq
  onResolve: (allow: boolean) => void
}): JSX.Element {
  const arg = permArg(req.input)
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-title">PERMISSION REQUESTED</div>
        <div className="modal-tool">
          <span className="tool-icon">{toolIcon(req.toolName)}</span>
          <strong>{req.toolName}</strong>
        </div>
        {arg && <pre className="modal-arg">{arg}</pre>}
        <div className="modal-actions">
          <button className="ghost" onClick={() => onResolve(false)}>
            Deny
          </button>
          <button className="primary" autoFocus onClick={() => onResolve(true)}>
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}
