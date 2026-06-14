// EXTEND tab container (docs/MAINTAINABILITY.md Phase 1). The console over the
// filesystem `.claude/` extension points — switches between the six panels.
// Extracted verbatim from App.tsx — behavior-preserving.
import { useState, type JSX } from 'react'
import type { McpServer } from '../../types'
import SkillsPanel from './SkillsPanel'
import CommandsPanel from './CommandsPanel'
import HooksPanel from './HooksPanel'
import McpPanel from './McpPanel'
import AgentsPanel from './AgentsPanel'
import PluginsPanel from './PluginsPanel'

type ExtendSection = 'skills' | 'commands' | 'hooks' | 'mcp' | 'agents' | 'plugins'

const EXTEND_SECTIONS: { id: ExtendSection; label: string; icon: string; ready: boolean }[] = [
  { id: 'skills', label: 'Skills', icon: '🧩', ready: true },
  { id: 'commands', label: 'Commands', icon: '⌨', ready: true },
  { id: 'hooks', label: 'Hooks', icon: '🪝', ready: true },
  { id: 'mcp', label: 'MCP', icon: '🔌', ready: true },
  { id: 'agents', label: 'Agents', icon: '🤖', ready: true },
  { id: 'plugins', label: 'Plugins', icon: '📦', ready: true }
]

/** The EXTEND tab: a console over the filesystem `.claude/` extension points. */
export default function ExtendView({
  onCommandsChanged,
  mcpStatus,
  onMcpChanged
}: {
  onCommandsChanged?: () => void
  mcpStatus: McpServer[]
  onMcpChanged?: () => void
}): JSX.Element {
  const [section, setSection] = useState<ExtendSection>('skills')
  const active = EXTEND_SECTIONS.find((s) => s.id === section)
  return (
    <div className="extend-view">
      <nav className="extend-nav">
        <div className="extend-nav-title">EXTEND</div>
        {EXTEND_SECTIONS.map((s) => (
          <button
            key={s.id}
            className={`extend-nav-item ${section === s.id ? 'on' : ''}`}
            onClick={() => setSection(s.id)}
          >
            <span className="extend-nav-icon">{s.icon}</span>
            <span className="extend-nav-label">{s.label}</span>
            {!s.ready && <span className="extend-soon">soon</span>}
          </button>
        ))}
      </nav>
      <div className="extend-body">
        {section === 'skills' ? (
          <SkillsPanel />
        ) : section === 'commands' ? (
          <CommandsPanel onChanged={onCommandsChanged} />
        ) : section === 'hooks' ? (
          <HooksPanel />
        ) : section === 'mcp' ? (
          <McpPanel status={mcpStatus} onChanged={onMcpChanged} />
        ) : section === 'agents' ? (
          <AgentsPanel />
        ) : section === 'plugins' ? (
          <PluginsPanel onChanged={onMcpChanged} />
        ) : (
          <div className="extend-stub">
            <div className="extend-stub-icon">{active?.icon}</div>
            <div className="extend-stub-title">{active?.label} — coming next</div>
            <div className="extend-stub-desc">
              This panel lands in a later roadmap phase. Skills is live now.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
