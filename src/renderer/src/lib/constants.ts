// Shared renderer constants + the pure effort→option mapping. Leaf module
// (docs/MAINTAINABILITY.md Phase 0): depends only on ./types. Extracted verbatim
// from App.tsx — behavior-preserving.
import type { Effort, EffortLabel, Permission, SlashCommand } from '../types'

export const EFFORTS: EffortLabel[] = ['AUTO', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'MAX']

export function effortOption(label: EffortLabel): Effort | undefined {
  return label === 'AUTO' ? undefined : (label.toLowerCase() as Effort)
}

export const PERMS: { id: Permission; title: string; desc: string }[] = [
  { id: 'plan', title: 'PLAN', desc: 'read-only, propose a plan' },
  { id: 'ask', title: 'ASK', desc: 'approve each tool use' },
  { id: 'acceptEdits', title: 'AUTO-EDIT', desc: 'file edits auto-approved' },
  { id: 'bypassPermissions', title: 'YOLO', desc: 'everything auto-approved' }
]

export const CLIENT_COMMANDS: SlashCommand[] = [
  {
    name: 'model',
    description: 'Set the model — alias or any id, e.g. /model claude-opus-4-6',
    argumentHint: '<name|id>'
  },
  { name: 'effort', description: 'Set reasoning effort', argumentHint: '<auto|low|medium|high|xhigh|max>' },
  {
    name: 'persona',
    description: "Set this conversation's persona (overrides the global agent)",
    argumentHint: '<instructions|clear>'
  },
  { name: 'permission', description: 'Set permission mode', argumentHint: '<plan|ask|auto-edit|yolo>' },
  {
    name: 'goal',
    description: 'Run autonomously until an objective is met (loops the session)',
    argumentHint: '[max] <objective>'
  },
  { name: 'clear', description: 'Start a new conversation', aliases: ['new'] },
  { name: 'help', description: 'Show available commands' }
]
