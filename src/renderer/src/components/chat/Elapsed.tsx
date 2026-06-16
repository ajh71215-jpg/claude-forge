// Live seconds counter for any in-progress activity. The SDK gives no mid-tool
// progress, so elapsed-since-start is the honest "still working" signal that
// keeps a running tool/turn from looking frozen. Times from mount.
import { useEffect, useState, type JSX } from 'react'

export default function Elapsed({ className = 'tool-elapsed' }: { className?: string }): JSX.Element {
  const [ms, setMs] = useState(0)
  useEffect(() => {
    const t0 = Date.now()
    const id = setInterval(() => setMs(Date.now() - t0), 100)
    return () => clearInterval(id)
  }, [])
  return <span className={className}>{(ms / 1000).toFixed(1)}s</span>
}
