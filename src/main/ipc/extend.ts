// EXTEND console IPC channels — skills · commands · hooks · mcp · agents ·
// plugins (docs/MAINTAINABILITY.md Phase 4). Extracted verbatim from the former
// src/main/index.ts.

import type { IpcMain } from 'electron'
import {
  listSkills,
  readSkill,
  writeSkill,
  deleteSkill,
  setSkillEnabled,
  type SkillInput
} from '../skills'
import { listBundledSkills, installBundledSkill } from '../skillsPack'
import {
  listCommands,
  readCommand,
  writeCommand,
  deleteCommand,
  type CommandInput
} from '../commands'
import { listHooks, saveHooks, type HookRule } from '../hooks'
import {
  listMcpServers,
  saveMcpServer,
  deleteMcpServer,
  type McpSaveInput
} from '../mcp'
import { listBundledMcpServers, installBundledMcpServer } from '../mcpPack'
import {
  listAgents,
  readAgent,
  writeAgent,
  deleteAgent,
  type AgentInput
} from '../agents'
import { listPlugins, addPlugin, setPluginEnabled, removePlugin } from '../plugins'
import {
  listProviders,
  saveProvider,
  deleteProvider,
  type ProviderSaveInput
} from '../providers'

export function register(ipc: IpcMain): void {
  // Skills console — edit `.claude/skills` and toggle which ones the model sees.
  ipc.handle('skills:list', () => listSkills())
  ipc.handle('skills:read', (_e, name: string) => readSkill(name))
  ipc.handle('skills:write', (_e, input: SkillInput) => writeSkill(input))
  ipc.handle('skills:delete', (_e, name: string) => deleteSkill(name))
  ipc.handle('skills:toggle', (_e, name: string, enabled: boolean) =>
    setSkillEnabled(name, enabled)
  )
  // Curated starter pack (mattpocock/skills absorption) — bundled, one-click install.
  ipc.handle('skills:bundled', () => listBundledSkills())
  ipc.handle('skills:install', (_e, name: string) => installBundledSkill(name))

  // Custom slash commands — `.claude/commands/<name>.md`.
  ipc.handle('commands:list', () => listCommands())
  ipc.handle('commands:read', (_e, name: string) => readCommand(name))
  ipc.handle('commands:write', (_e, input: CommandInput) => writeCommand(input))
  ipc.handle('commands:delete', (_e, name: string) => deleteCommand(name))

  // Hooks — shell-command hooks in `.claude/settings.json` (portable standard).
  ipc.handle('hooks:list', () => listHooks())
  ipc.handle('hooks:save', (_e, rules: HookRule[]) => saveHooks(rules))

  // MCP servers — Forge-owned connections passed via the SDK mcpServers option.
  ipc.handle('mcp:list', () => listMcpServers())
  ipc.handle('mcp:save', (_e, input: McpSaveInput) => saveMcpServer(input))
  ipc.handle('mcp:delete', (_e, name: string) => deleteMcpServer(name))
  // Curated MCP pack (codegraph absorption) — recommended local servers, one-click register.
  ipc.handle('mcp:bundled', () => listBundledMcpServers())
  ipc.handle('mcp:install', (_e, name: string) => installBundledMcpServer(name))

  // Reusable subagents — `.claude/agents/<name>.md`.
  ipc.handle('agents:list', () => listAgents())
  ipc.handle('agents:read', (_e, name: string) => readAgent(name))
  ipc.handle('agents:write', (_e, input: AgentInput) => writeAgent(input))
  ipc.handle('agents:delete', (_e, name: string) => deleteAgent(name))

  // Plugins — local bundles passed via the SDK plugins option.
  ipc.handle('plugins:list', () => listPlugins())
  ipc.handle('plugins:add', (_e, path: string) => addPlugin(path))
  ipc.handle('plugins:toggle', (_e, path: string, enabled: boolean) =>
    setPluginEnabled(path, enabled)
  )
  ipc.handle('plugins:remove', (_e, path: string) => removePlugin(path))

  // Free/cheaper providers (goose-routed) — secret-bearing, in forge-providers.json.
  ipc.handle('providers:list', () => listProviders())
  ipc.handle('providers:save', (_e, input: ProviderSaveInput) => saveProvider(input))
  ipc.handle('providers:delete', (_e, id: string) => deleteProvider(id))
}
