// EXTEND tab container (docs/MAINTAINABILITY.md Phase 1). The console over the
// filesystem `.claude/` extension points — switches between the six panels.
// Extracted verbatim from App.tsx — behavior-preserving.
import { useState, type JSX } from 'react'
import type { McpServer } from '../../types'
import Icon, { type IconName } from '../Icon'
import SkillsPanel from './SkillsPanel'
import CommandsPanel from './CommandsPanel'
import HooksPanel from './HooksPanel'
import McpPanel from './McpPanel'
import AgentsPanel from './AgentsPanel'
import PluginsPanel from './PluginsPanel'
import ProvidersPanel from './ProvidersPanel'
import MemoryPanel from './MemoryPanel'

type ExtendSection =
  | 'skills'
  | 'commands'
  | 'hooks'
  | 'mcp'
  | 'agents'
  | 'plugins'
  | 'providers'
  | 'memory'

const EXTEND_SECTIONS: { id: ExtendSection; label: string; icon: IconName; ready: boolean }[] = [
  { id: 'skills', label: 'Skills', icon: 'skills', ready: true },
  { id: 'commands', label: 'Commands', icon: 'commands', ready: true },
  { id: 'hooks', label: 'Hooks', icon: 'hooks', ready: true },
  { id: 'mcp', label: 'MCP', icon: 'mcp', ready: true },
  { id: 'agents', label: 'Agents', icon: 'agents', ready: true },
  { id: 'plugins', label: 'Plugins', icon: 'plugins', ready: true },
  { id: 'providers', label: 'Providers', icon: 'mcp', ready: true },
  { id: 'memory', label: 'Memory', icon: 'agents', ready: true }
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
            <Icon name={s.icon} className="extend-nav-icon" />
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
        ) : section === 'providers' ? (
          <ProvidersPanel />
        ) : section === 'memory' ? (
          <MemoryPanel />
        ) : (
          <div className="extend-stub">
            {active && <Icon name={active.icon} className="extend-stub-icon" />}
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
