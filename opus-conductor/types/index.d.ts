export type Size = 'S' | 'M' | 'L'
export type Owner = 'opus' | 'sonnet' | 'haiku'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh'
export type TaskStatus = 'pending' | 'active' | 'done' | 'dropped'

export type Task = {
  id: number
  title: string
  size: Size
  owner: Owner
  /** the reasoning effort Opus chose for it; absent on tasks planned before 1.4 */
  effort?: Effort
  status: TaskStatus
  agentId: string
  startedAt: number
  doneAt: number
  note: string
}

/** holding: Opus waits on something outside the session (a render, CI, a background command); autopilot stays quiet */
export type MissionStatus = 'running' | 'waiting' | 'holding' | 'done' | 'stopped'

export type Mission = {
  title: string
  condition: string
  startedAt: number
  endedAt: number
  status: MissionStatus
  tasks: Task[]
  nextId: number
  planAt: number
  continues: number
  note: string
  doing: string
  /** while holding: when the fallback timer wakes Opus; 0 = only a notification or the person does */
  holdUntil: number
  /** when autopilot last nudged; 0 when the last turn was not its */
  nudgedAt: number
  /** the board's fingerprint at the last nudge: unchanged after the turn = a stall */
  mark: string
  /** stalls in a row: each one doubles the hold */
  stalls: number
  /** when Opus started a background task this turn (Bash run_in_background, Monitor); 0 otherwise */
  pendingAt: number
  /** main-loop write tool calls so far: part of the fingerprint */
  writes: number
}

export type AgentStatus = 'running' | 'done' | 'failed' | 'stopped'

export type AgentRow = {
  id: string
  label: string
  model: string
  type: string
  startedAt: number
  endedAt: number
  status: AgentStatus
  tools: number
  doing: string
  pct: number
  /** its tool count when it last reported pct: the bar creeps from there until the next report */
  pctTools?: number
  taskId: number
  /** the effort its agent type runs at; absent for agents that aren't the conductor's */
  effort?: Effort
  summary: string
}

export type ConductorSettings = { auto: boolean; maxContinues: number }

declare module 'claude-code' {
  interface PluginState {
    'opus-conductor': {
      mission: Mission | null
      agents: AgentRow[]
      settings: ConductorSettings
    }
  }
}
