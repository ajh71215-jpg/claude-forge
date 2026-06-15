// Forge-themed confirm dialog, replacing the native window.confirm() (which
// renders an OS-chrome modal that ignores the app theme). Exposed as a
// promise-based useConfirm() hook so call sites read almost like the native API:
//   if (!(await confirm({ message, danger: true }))) return
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type JSX,
  type ReactNode
} from 'react'

export interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** Style the confirm button as destructive (red). */
  danger?: boolean
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn>(async () => false)

/** Get the app-wide confirm() — resolves true if the user confirms. */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext)
}

interface Pending {
  opts: ConfirmOptions
  resolve: (v: boolean) => void
}

export function ConfirmProvider({ children }: { children: ReactNode }): JSX.Element {
  const [pending, setPending] = useState<Pending | null>(null)

  const confirm = useCallback<ConfirmFn>(
    (opts) => new Promise<boolean>((resolve) => setPending({ opts, resolve })),
    []
  )

  const close = useCallback(
    (value: boolean): void => {
      setPending((p) => {
        p?.resolve(value)
        return null
      })
    },
    []
  )

  // Enter confirms, Escape cancels while the dialog is open.
  useEffect(() => {
    if (!pending) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        close(false)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        close(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, close])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div className="modal-overlay" onClick={() => close(false)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">{pending.opts.title ?? 'CONFIRM'}</div>
            <pre className="confirm-msg">{pending.opts.message}</pre>
            <div className="modal-actions">
              <button className="ghost" onClick={() => close(false)}>
                {pending.opts.cancelLabel ?? 'Cancel'}
              </button>
              <button
                className={`primary${pending.opts.danger ? ' danger' : ''}`}
                onClick={() => close(true)}
                autoFocus
              >
                {pending.opts.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
