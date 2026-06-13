import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import {
  getStatus,
  setSubscription,
  setOAuthToken,
  setApiKey,
  clearAuth
} from './auth'
import { getPersona, setPersona, type Persona } from './persona'
import {
  listSkills,
  readSkill,
  writeSkill,
  deleteSkill,
  setSkillEnabled,
  type SkillInput
} from './skills'
import {
  listCommands,
  readCommand,
  writeCommand,
  deleteCommand,
  type CommandInput
} from './commands'
import { listHooks, saveHooks, type HookRule } from './hooks'
import {
  listMcpServers,
  saveMcpServer,
  deleteMcpServer,
  type McpSaveInput
} from './mcp'
import {
  listAgents,
  readAgent,
  writeAgent,
  deleteAgent,
  type AgentInput
} from './agents'
import { listPlugins, addPlugin, setPluginEnabled, removePlugin } from './plugins'
import {
  runStreaming,
  interruptRun,
  respondPermission,
  respondDialog,
  type QuestionResult,
  getCapabilities,
  getSessions,
  getUsage,
  getTranscript,
  compactSession,
  type RunOptions
} from './agent'

// Optional remote debugging for local verification: set FORGE_CDP=<port>.
// No effect in normal use (only active when the env var is present).
if (process.env.FORGE_CDP) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.FORGE_CDP)
  app.commandLine.appendSwitch('remote-allow-origins', '*')
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 832,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: '#0b0a09',
    title: 'Claude Forge',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // Open external links in the OS browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Auth IPC. The plaintext secret never crosses back to the renderer — only
  // status (mode + whether an existing login exists) is returned.
  ipcMain.handle('auth:status', () => getStatus())
  ipcMain.handle('auth:set-subscription', () => setSubscription())
  ipcMain.handle('auth:set-oauth-token', (_e, token: string) => setOAuthToken(token))
  ipcMain.handle('auth:set-api-key', (_e, key: string) => setApiKey(key))
  ipcMain.handle('auth:clear', () => clearAuth())

  // Streaming run — events are pushed back on 'agent:event'.
  ipcMain.handle('agent:start', (e, runId: string, prompt: string, opts?: RunOptions) =>
    runStreaming(e.sender, runId, prompt, opts ?? {})
  )
  ipcMain.handle('agent:interrupt', (_e, runId: string) => interruptRun(runId))
  ipcMain.handle('agent:permission-result', (_e, id: string, allow: boolean) =>
    respondPermission(id, allow)
  )
  ipcMain.handle('agent:dialog-result', (_e, id: string, result: QuestionResult) =>
    respondDialog(id, result)
  )
  ipcMain.handle('agent:capabilities', () => getCapabilities())
  ipcMain.handle('agent:sessions', () => getSessions())
  ipcMain.handle('agent:usage', () => getUsage())
  ipcMain.handle('agent:transcript', (_e, sessionId: string) => getTranscript(sessionId))
  ipcMain.handle('agent:compact', (_e, sessionId: string) => compactSession(sessionId))

  // Agent behavior customization (persona).
  ipcMain.handle('persona:get', () => getPersona())
  ipcMain.handle('persona:set', (_e, persona: Persona) => setPersona(persona))

  // Skills console — edit `.claude/skills` and toggle which ones the model sees.
  ipcMain.handle('skills:list', () => listSkills())
  ipcMain.handle('skills:read', (_e, name: string) => readSkill(name))
  ipcMain.handle('skills:write', (_e, input: SkillInput) => writeSkill(input))
  ipcMain.handle('skills:delete', (_e, name: string) => deleteSkill(name))
  ipcMain.handle('skills:toggle', (_e, name: string, enabled: boolean) =>
    setSkillEnabled(name, enabled)
  )

  // Custom slash commands — `.claude/commands/<name>.md`.
  ipcMain.handle('commands:list', () => listCommands())
  ipcMain.handle('commands:read', (_e, name: string) => readCommand(name))
  ipcMain.handle('commands:write', (_e, input: CommandInput) => writeCommand(input))
  ipcMain.handle('commands:delete', (_e, name: string) => deleteCommand(name))

  // Hooks — shell-command hooks in `.claude/settings.json` (portable standard).
  ipcMain.handle('hooks:list', () => listHooks())
  ipcMain.handle('hooks:save', (_e, rules: HookRule[]) => saveHooks(rules))

  // MCP servers — Forge-owned connections passed via the SDK mcpServers option.
  ipcMain.handle('mcp:list', () => listMcpServers())
  ipcMain.handle('mcp:save', (_e, input: McpSaveInput) => saveMcpServer(input))
  ipcMain.handle('mcp:delete', (_e, name: string) => deleteMcpServer(name))

  // Reusable subagents — `.claude/agents/<name>.md`.
  ipcMain.handle('agents:list', () => listAgents())
  ipcMain.handle('agents:read', (_e, name: string) => readAgent(name))
  ipcMain.handle('agents:write', (_e, input: AgentInput) => writeAgent(input))
  ipcMain.handle('agents:delete', (_e, name: string) => deleteAgent(name))

  // Plugins — local bundles passed via the SDK plugins option.
  ipcMain.handle('plugins:list', () => listPlugins())
  ipcMain.handle('plugins:add', (_e, path: string) => addPlugin(path))
  ipcMain.handle('plugins:toggle', (_e, path: string, enabled: boolean) =>
    setPluginEnabled(path, enabled)
  )
  ipcMain.handle('plugins:remove', (_e, path: string) => removePlugin(path))

  // Custom title-bar window controls.
  ipcMain.handle('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.handle('window:maximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (w?.isMaximized()) w.unmaximize()
    else w?.maximize()
  })
  ipcMain.handle('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
