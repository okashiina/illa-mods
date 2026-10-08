// Opus Conductor's mission: the plan Opus keeps through the mod's tool, the
// progress the pane draws from it, and the words the mod hands the models.
// Pure functions, no `$`: the tests drive them directly.

import type { AgentRow, Mission, Owner, Size, Task } from '../types'

export const SONNET = 'claude-sonnet-5-5'
export const HAIKU = 'claude-haiku-5-5'
export const WORKER = 'worker'
export const SCOUT = 'scout'
const SIZES: Record<Size, number> = { S: 1, M: 2, L: 3 }
const STOP = /^(stop|cancel|off|end|abort)$/i

export function isStopWord(text: string): boolean {
  return STOP.test(text.trim())
}

export function clip(text: unknown, max: number): string {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

export function minutes(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

export function newMission(condition: string, now: number): Mission {
  const first = condition.split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? 'Mission'
  return {
    title: clip(first, 120),
    condition: condition.slice(0, 4000),
    startedAt: now,
    endedAt: 0,
    status: 'running',
    tasks: [],
    nextId: 1,
    planAt: 0,
    continues: 0,
    note: '',
    doing: 'reading the ask',
  }
}

type RawTask = { title?: unknown; size?: unknown; owner?: unknown }

function sizeOf(v: unknown): Size {
  const s = String(v ?? '').trim().toUpperCase().charAt(0)
  return s === 'S' || s === 'L' ? s : 'M'
}

function ownerOf(v: unknown): Owner {
  const s = String(v ?? '')
  return /opus/i.test(s) ? 'opus' : /haiku|scout/i.test(s) ? 'haiku' : 'sonnet'
}

/**
 * The model a mission's spawn should run on, or undefined to leave the call as made.
 * Labor defaults to Sonnet 5.5; read-only exploring defaults to Haiku 5.5; any
 * Haiku request is lifted to Haiku 5.5; an explicit Sonnet/Opus/Fable choice stands.
 */
export function steerModel(model: string | undefined, subagentType: string, own: { worker: string; scout: string }): string | undefined {
  if (model) return /haiku/i.test(model) && !/5[-.]5/.test(model) ? HAIKU : undefined
  if (subagentType === own.worker || subagentType === own.scout) return undefined
  return /^explore$/i.test(subagentType) ? HAIKU : SONNET
}

function makeTasks(m: Mission, raw: unknown): Task[] {
  const list = Array.isArray(raw) ? (raw as RawTask[]) : []
  return list
    .filter(t => t && clip(t.title, 140))
    .map(t => ({
      id: m.nextId++,
      title: clip(t.title, 140),
      size: sizeOf(t.size),
      owner: ownerOf(t.owner),
      status: 'pending' as const,
      agentId: '',
      startedAt: 0,
      doneAt: 0,
      note: '',
    }))
}

export type MissionInput = {
  action?: unknown
  tasks?: unknown
  ids?: unknown
  note?: unknown
}

function idsOf(raw: unknown): number[] {
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]
  return list.map(Number).filter(n => Number.isInteger(n))
}

/** Applies one call of the mission tool; returns the mission after it and the reply. */
export function applyAction(
  before: Mission,
  input: MissionInput,
  now: number,
): { mission: Mission; text: string } {
  const m: Mission = { ...before, tasks: before.tasks.map(t => ({ ...t })) }
  const action = String(input.action ?? 'show').toLowerCase()
  const note = clip(input.note, 300)
  const pick = (ids: number[]) => m.tasks.filter(t => ids.includes(t.id))

  if (action === 'plan' || action === 'add') {
    if (action === 'plan') m.tasks = m.tasks.filter(t => t.status !== 'pending')
    const added = makeTasks(m, input.tasks)
    if (!added.length) return { mission: before, text: 'No tasks given. Pass tasks: [{ title, size: S|M|L, owner: opus|sonnet }].' }
    m.tasks.push(...added)
    if (!m.planAt) m.planAt = now
    m.doing = 'planned; dispatching'
    return { mission: m, text: `${action === 'plan' ? 'Plan set' : 'Added'}: ${added.map(t => `#${t.id} ${t.title} (${t.size}, ${t.owner})`).join('; ')}.\n${summary(m)}` }
  }

  if (action === 'start' || action === 'done' || action === 'drop') {
    const hit = pick(idsOf(input.ids))
    if (!hit.length) return { mission: before, text: `No task with ids ${JSON.stringify(input.ids)}. ${summary(before)}` }
    for (const t of hit) {
      if (action === 'start') {
        t.status = 'active'
        t.startedAt = t.startedAt || now
      } else if (action === 'done') {
        t.status = 'done'
        t.doneAt = now
        t.startedAt = t.startedAt || now
      } else {
        t.status = 'dropped'
      }
      if (note) t.note = note
    }
    if (m.status === 'waiting') m.status = 'running'
    return { mission: m, text: summary(m) }
  }

  if (action === 'wait') {
    m.status = 'waiting'
    m.note = note || 'waiting on the person'
    return { mission: m, text: 'Mission paused for the person. Autopilot will not continue until they reply.' }
  }

  if (action === 'complete') {
    m.status = 'done'
    m.endedAt = now
    m.note = note
    // a verified mission finishes every task still on its plan
    for (const t of m.tasks) {
      if (t.status === 'active' || t.status === 'pending') {
        t.status = 'done'
        t.doneAt = now
      }
    }
    return { mission: m, text: `Mission complete. ${summary(m)}` }
  }

  return { mission: before, text: summary(before) }
}

export function live(m: Mission): Task[] {
  return m.tasks.filter(t => t.status !== 'dropped')
}

/** Finished weight over the plan's weight; an active task counts its worker's reported %. */
export function progress(m: Mission, agents: readonly AgentRow[] = []) {
  const tasks = live(m)
  const total = tasks.reduce((a, t) => a + SIZES[t.size], 0)
  let done = 0
  for (const t of tasks) {
    if (t.status === 'done') done += SIZES[t.size]
    else if (t.status === 'active') {
      const a = agents.find(x => x.taskId === t.id && x.status === 'running' && x.pct > 0)
      if (a) done += SIZES[t.size] * Math.min(0.9, a.pct / 100)
    }
  }
  const doneN = tasks.filter(t => t.status === 'done').length
  const fraction = m.status === 'done' ? 1 : total ? done / total : 0
  return { n: tasks.length, doneN, fraction, pct: Math.round(fraction * 100) }
}

/** Time left at the mission's own pace, once a quarter of it is done. */
export function eta(m: Mission, agents: readonly AgentRow[], now: number): number | null {
  const p = progress(m, agents)
  if (m.status !== 'running' || !m.planAt || p.fraction < 0.25 || p.fraction >= 1) return null
  const spent = now - m.planAt
  return (spent / p.fraction) * (1 - p.fraction)
}

export function summary(m: Mission): string {
  const p = progress(m)
  const rows = m.tasks.map(t => `#${t.id} [${t.status}] ${t.size} ${t.owner}: ${t.title}${t.note ? ` (${t.note})` : ''}`)
  return [`Mission "${m.title}": ${p.doneN}/${p.n} tasks, ${p.pct}%.`, ...rows].join('\n')
}

/** The task an Agent call is for: "#3" in its description or prompt. */
export function taskIdIn(...texts: (string | undefined)[]): number {
  for (const t of texts) {
    const hit = /#(\d{1,4})\b/.exec(t ?? '')
    if (hit) return Number(hit[1])
  }
  return 0
}

/** One short line of what a tool call does, for an agent's card. */
export function describeCall(tool: string, input: Record<string, unknown>): string {
  const file = (v: unknown) => String(v ?? '').split(/[\\/]/).pop() ?? ''
  switch (tool) {
    case 'Bash':
    case 'PowerShell': {
      // the step that matters, not the cd and variables in front of it
      const parts = String(input.command ?? '').split(/&&|;|\n/).map(x => x.trim()).filter(Boolean)
      const step = parts.filter(x => !/^(cd|set|export|\$?[A-Za-z_][A-Za-z0-9_]*=)/.test(x)).pop() ?? parts.pop() ?? ''
      return `$ ${clip(step, 70)}`
    }
    case 'Read':
      return `reading ${file(input.file_path)}`
    case 'Edit':
    case 'MultiEdit':
      return `editing ${file(input.file_path)}`
    case 'Write':
      return `writing ${file(input.file_path)}`
    case 'Grep':
      return `searching "${clip(input.pattern, 40)}"`
    case 'Glob':
      return `finding ${clip(input.pattern, 40)}`
    case 'WebFetch':
    case 'WebSearch':
      return `web: ${clip(input.query ?? input.url, 50)}`
    case 'Agent':
      return `delegating: ${clip(input.description, 50)}`
    default:
      return tool.startsWith('mcp__') ? tool.split('__').slice(1).join(' · ') : tool
  }
}

// ---------- words for the models ----------

export function missionToolSpec(name: string) {
  return {
    name,
    description:
      'Opus Conductor mission board: the plan the person watches live. Actions: ' +
      '"plan" (replace pending tasks) / "add" with tasks [{ title, size: S|M|L, owner: "opus"|"sonnet"|"haiku" }]; ' +
      '"start" / "done" / "drop" with ids [n] and an optional note; "wait" with a note when you need the person; ' +
      '"complete" with a note once the whole mission is verified; "show". Mark a task done only after you verified its result.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['plan', 'add', 'start', 'done', 'drop', 'wait', 'complete', 'show'] },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              size: { type: 'string', enum: ['S', 'M', 'L'] },
              owner: { type: 'string', enum: ['opus', 'sonnet', 'haiku'] },
            },
            required: ['title'],
          },
        },
        ids: { type: 'array', items: { type: 'integer' } },
        note: { type: 'string' },
      },
      required: ['action'],
    },
  }
}

export function reportToolSpec(name: string) {
  return {
    name,
    description:
      'For a delegated worker: report your progress to the conductor\'s live board. ' +
      'pct is your own honest estimate 0-100 of your assignment; doing is a few words on what you are doing now. ' +
      'Call it after each meaningful step (roughly every 3-5 tool calls).',
    inputSchema: {
      type: 'object',
      properties: { pct: { type: 'number', minimum: 0, maximum: 100 }, doing: { type: 'string' } },
      required: ['pct', 'doing'],
    },
  }
}

export function scoutPrompt(reportTool: string): string {
  return `You are a Haiku 5.5 scout under an Opus 5.5 conductor. You do one narrow, well-defined job fast: look things up, read and sweep files, extract or summarize, triage, or run a named check and report what it says.

Rules:
- Do exactly the job in the brief. Do not design, refactor, or decide; if the job needs judgment the brief does not settle, stop and say so.
- Prefer reading over writing. Edit files only when the brief names the exact change.
- Quote evidence: file paths with line numbers, command output, URLs. Never guess a value you could not find; say it is missing.
- Report progress with ${reportTool} (pct 0-100 and a few words) after each meaningful step, and pct 100 just before you finish.
- Finish with a compact result in the shape the brief asks for, then any gaps.`
}

export function workerPrompt(reportTool: string): string {
  return `You are a Sonnet 5.5 worker under an Opus 5.5 conductor. The conductor owns design decisions, integration and verification; you own exactly one delegated outcome.

Rules:
- Do the assignment exactly as briefed. Stay inside the stated scope; never touch files listed under "Do not touch".
- Locked decisions are not yours to revisit. If the brief is wrong or blocked, stop and report the evidence instead of widening scope.
- Report progress with ${reportTool} (pct 0-100 and a few words) after each meaningful step, and pct 100 just before you finish.
- Run the verification the brief names. Do not claim a check passed that you did not run.
- Finish with: summary, changed files, checks run with their result, remaining risks.`
}

export function continuation(m: Mission): string {
  const open = live(m).filter(t => t.status !== 'done')
  if (!m.planAt) return `Continue the Opus Conductor mission "${m.title}": make the plan with the mission tool first, then delegate.`
  return `Continue the Opus Conductor mission "${m.title}". Open tasks: ${open.map(t => `#${t.id} ${t.title} [${t.status}, ${t.owner}]`).join('; ')}. Delegate, verify, integrate and update the board. If you need the person, call the mission tool with action "wait".`
}
