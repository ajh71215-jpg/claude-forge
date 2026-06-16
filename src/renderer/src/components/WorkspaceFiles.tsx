// Workspace file viewer for the active conversation. Each conversation runs in
// its own isolated workspace (<root>/ws/<id>/); this shows the files the agent
// created/edited there, newest first, with a content preview. Local reads only.
import { useEffect, useState, type JSX } from 'react'
import type { WorkspaceFile } from '../types'
import Md from './Md'

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
function relTime(ms: number, now: number): string {
  const d = Math.max(0, now - ms)
  if (d < 60_000) return 'just now'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`
  return `${Math.floor(d / 86_400_000)}d ago`
}
function langOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', json: 'json', md: 'markdown',
    css: 'css', html: 'html', py: 'python', sh: 'bash', yml: 'yaml', yaml: 'yaml'
  }
  return map[ext] ?? ''
}

export default function WorkspaceFiles({
  workspaceId,
  onClose
}: {
  workspaceId: string
  onClose: () => void
}): JSX.Element {
  const [files, setFiles] = useState<WorkspaceFile[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')
  // Recompute on each render so relative mtimes aren't frozen at mount.
  const now = Date.now()
  const [view, setView] = useState<'files' | 'map'>('files')
  const [map, setMap] = useState<{ map: string; fileCount: number } | null>(null)

  useEffect(() => {
    window.forge.workspace
      .list(workspaceId)
      .then((f) => {
        setFiles(f)
        if (f[0]) setSel(f[0].path)
      })
      .catch(() => setFiles([]))
  }, [workspaceId])

  useEffect(() => {
    if (view !== 'map' || map) return
    window.forge.workspace
      .repoMap(workspaceId)
      .then((r) => setMap({ map: r.map, fileCount: r.fileCount }))
      .catch(() => setMap({ map: '', fileCount: 0 }))
  }, [view, map, workspaceId])

  useEffect(() => {
    if (!sel) {
      setContent('')
      return
    }
    window.forge.workspace.read(workspaceId, sel).then(setContent).catch(() => setContent(''))
  }, [sel, workspaceId])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wsf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          WORKSPACE — this conversation
          <span className="wsf-tabs">
            <button className={`wsf-tab ${view === 'files' ? 'on' : ''}`} onClick={() => setView('files')}>
              Files
            </button>
            <button className={`wsf-tab ${view === 'map' ? 'on' : ''}`} onClick={() => setView('map')}>
              Repo map
            </button>
          </span>
        </div>
        {view === 'map' ? (
          <div className="wsf-body wsf-map">
            {map === null ? (
              <div className="wsf-note">building map…</div>
            ) : map.map.trim() ? (
              <>
                <div className="wsf-note">
                  {map.fileCount} source files · most-imported first · this is what Forge injects
                  to help the agent navigate without exhaustive searching.
                </div>
                <pre className="wsf-mappre">{map.map}</pre>
              </>
            ) : (
              <div className="wsf-note">
                No source files to map yet. As the agent writes code here, a structural map appears
                and is injected into new conversations in this workspace.
              </div>
            )}
          </div>
        ) : (
        <div className="wsf-body">
          <div className="wsf-list">
            {files === null && <div className="wsf-note">loading…</div>}
            {files && files.length === 0 && (
              <div className="wsf-note">
                No files yet. Files the agent creates or edits in this conversation’s
                isolated workspace appear here.
              </div>
            )}
            {files?.map((f) => (
              <button
                key={f.path}
                className={`wsf-file ${sel === f.path ? 'on' : ''}`}
                onClick={() => setSel(f.path)}
                title={f.path}
              >
                <span className="wsf-file-path">{f.path}</span>
                <span className="wsf-file-meta">
                  {fmtSize(f.size)} · {relTime(f.mtime, now)}
                </span>
              </button>
            ))}
          </div>
          <div className="wsf-preview">
            {sel ? (
              content ? (
                <Md>{'```' + langOf(sel) + '\n' + content + '\n```'}</Md>
              ) : (
                <div className="wsf-note">empty / unreadable</div>
              )
            ) : (
              <div className="wsf-note">Select a file to preview.</div>
            )}
          </div>
        </div>
        )}
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
