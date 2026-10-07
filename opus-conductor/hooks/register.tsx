// Opus Conductor: Opus 5.5 thinks, plans and integrates; Sonnet 5.5 workers do
// the hard labor. Adapted from the SOL orchestrator skill (Sol -> Opus, Luna ->
// Sonnet) with a /goal-style progress meter.
// - /conduct <goal> (commands/conduct.md): hands Opus the conductor brief; the
//   hook starts the mission board and opens the pane.
// - The model gets mcp__opus-conductor__mission (the plan board) and the
//   opus-conductor:worker agent type (Sonnet 5.5). Workers report their own %
//   with mcp__opus-conductor__report.
// - Pane: progress ring (desktop), mission bar, every agent with its model,
//   what it's doing right now, its %, and the plan. A band above the prompt and
//   a status line show the same in short.
// - Autopilot: while the mission is unfinished and no worker is running, an
//   ended turn is followed by a "continue" prompt (at most maxContinues times).

import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { AgentRow, Mission, ConductorSettings, Task } from '../types'
import {
  SONNET,
  WORKER,
  applyAction,
  clip,
  continuation,
  describeCall,
  eta,
  isStopWord,
  minutes,
  missionToolSpec,
  newMission,
  progress,
  reportToolSpec,
  taskIdIn,
  workerPrompt,
} from './mission'

const PLUGIN = 'opus-conductor'
const PANE = 'opus-conductor'
const RECENT_MS = 10 * 60000

const missionAtom = atom({ plugin: 'opus-conductor', key: 'mission' } as const, null)
const agentsAtom = atom({ plugin: 'opus-conductor', key: 'agents' } as const, [])
const settingsAtom = atom({ plugin: 'opus-conductor', key: 'settings' } as const, { auto: true, maxContinues: 8 } as ConductorSettings)

const COLOR = { opus: '#D97757', sonnet: '#6A9BCC', done: '#3FB950', wait: '#D29922', fail: '#F85149', track: '#8B949E' }

type $ = EngineInterface
type Kit = Elements[keyof Elements]

function isLive(m: Mission | null): m is Mission {
  return !!m && (m.status === 'running' || m.status === 'waiting')
}

async function sync($: $) {
  const m = await read($, missionAtom)
  const agents = await read($, agentsAtom)
  const running = agents.filter(a => a.status === 'running').length
  if (isLive(m)) {
    const p = progress(m, agents)
    const word = m.status === 'waiting' ? 'waiting on you' : m.planAt ? `${p.pct}%` : 'planning'
    $.ui.status(`◆ conduct ${word}${running ? ` · ${running} agent${running > 1 ? 's' : ''}` : ''}`)
  } else if (running) {
    $.ui.status(`◆ ${running} agent${running > 1 ? 's' : ''} running`)
  } else {
    $.ui.status(undefined)
  }
}

async function setMission($: $, fn: (m: Mission | null) => Mission | null) {
  await update($, missionAtom, m => fn(m ?? null))
  await sync($)
}

async function setAgents($: $, fn: (list: AgentRow[]) => AgentRow[]) {
  await update($, agentsAtom, list => fn([...(list ?? [])]).slice(-40))
  await sync($)
}

async function openPane($: $) {
  await $.ui.open({ id: PANE, title: 'Opus Conductor' })
}

export const register: Register = on => {
  // Recomputed on every load: session.start registers them again.
  let missionTool = `mcp__${PLUGIN}__mission`
  let reportTool = `mcp__${PLUGIN}__report`
  let workerType = `${PLUGIN}:${WORKER}`
  let warnedModel = false

  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('settings').catch(() => undefined)
    if (saved && typeof saved === 'object') await update($, settingsAtom, s => ({ ...s, ...(saved as Partial<ConductorSettings>) }))
    try {
      missionTool = (await $.tool.register(missionToolSpec('mission'))).tool
      reportTool = (await $.tool.register(reportToolSpec('report'))).tool
    } catch (err) {
      $.ui.log(`opus-conductor: tools did not register (${String(err)})`)
    }
    try {
      workerType = (
        await $.agent.register({
          name: WORKER,
          description:
            'Sonnet 5.5 worker for the Opus Conductor. Give it ONE well-scoped outcome with a full delegation contract: implementation against settled interfaces, refactors, tests, extraction, bounded debugging or research sweeps.',
          prompt: workerPrompt(reportTool),
          model: SONNET,
        })
      ).agent
    } catch (err) {
      $.ui.log(`opus-conductor: worker agent did not register (${String(err)})`)
    }
    // elapsed times and ETAs move while nothing is written
    $.clock.every(5000, () => {
      void read($, missionAtom).then(m => {
        if (isLive(m)) $.ui.invalidate('ui.render')
      })
    })
    await sync($)

    return next(e)
  })

  // ---------- the command ----------

  // /conduct is the plugin's own markdown command (commands/conduct.md), so every
  // surface lists it. Its body is the brief Opus reads; this hook adds the board,
  // and answers the control words itself without starting a turn.
  on('command.run', { command: ['conduct', 'opus-conductor:conduct'] }, async ($, e, next) => {
    const args = e.args.trim()
    const now = await $.clock.now()
    const [key, value, ...rest] = args.toLowerCase().split(/\s+/)

    if (!args) {
      await openPane($)
      return { text: 'Opus Conductor board opened.' }
    }
    if (isStopWord(args)) {
      await setMission($, m => (isLive(m) ? { ...m, status: 'stopped', endedAt: now } : m))
      return { text: 'Mission stopped. Running agents finish on their own.' }
    }
    if (key === 'auto' && (value === 'on' || value === 'off') && !rest.length) {
      const saved = await update($, settingsAtom, s => ({ ...s, auto: value === 'on' }))
      await $.store.set('settings', saved).catch(() => undefined)
      return { text: `Autopilot ${value}.` }
    }
    if (key === 'clear' && !value) {
      await setMission($, () => null)
      await setAgents($, list => list.filter(a => a.status === 'running'))
      return { text: 'Conductor board cleared.' }
    }

    await setMission($, () => newMission(args, now))
    await setAgents($, list => list.filter(a => a.status === 'running'))
    await openPane($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // the person speaking resumes a waiting mission and refills the autopilot
    if (e.origin.kind === 'composer') {
      await setMission($, m => (isLive(m) ? { ...m, status: 'running', continues: 0 } : m))
    }
    return next(e)
  })

  // ---------- tools: the board, worker reports, and what everyone is doing ----------

  on('tool.call', async ($, e, next) => {
    const now = await $.clock.now()
    const input = e as unknown as Record<string, unknown>

    if (e.tool === missionTool) {
      let reply = ''
      await setMission($, m => {
        const first = clip((input.tasks as { title?: string }[] | undefined)?.[0]?.title ?? 'Mission', 120)
        const action = String(input.action ?? '')
        // a finished mission is history: a new plan is a new mission, more work reopens it
        const base =
          !m || m.status === 'stopped' || (m.status === 'done' && action === 'plan')
            ? newMission(first, now)
            : m.status === 'done' && (action === 'add' || action === 'start')
              ? { ...m, status: 'running' as const, endedAt: 0, continues: 0 }
              : m
        const r = applyAction(base, input, now)
        reply = r.text
        return r.mission
      })
      if ((await read($, missionAtom))?.status === 'done') $.ui.toast('◆ Mission complete')
      return { result: reply }
    }

    if (e.tool === reportTool) {
      if (!e.agentId) return { result: 'Only delegated workers report progress; Opus updates the board with the mission tool.' }
      const pct = Math.max(0, Math.min(100, Math.round(Number(input.pct) || 0)))
      await setAgents($, list => list.map(a => (a.id === e.agentId ? { ...a, pct, doing: clip(input.doing, 90) || a.doing } : a)))
      return { result: 'Reported.' }
    }

    const doing = describeCall(String(e.tool), input)
    if (e.agentId) {
      const id = e.agentId
      const known = (await read($, agentsAtom)).some(a => a.id === id)
      if (known) await setAgents($, list => list.map(a => (a.id === id ? { ...a, tools: a.tools + 1, doing } : a)))
    } else if (e.tool !== 'Agent') {
      const m = await read($, missionAtom)
      if (isLive(m)) await setMission($, x => (x ? { ...x, doing } : x))
    }

    return next(e)
  })

  // ---------- agents: steer models, and put each one on the board ----------

  on('agent.spawn', async ($, e, next) => {
    const m = await read($, missionAtom)
    let input = e
    if (isLive(m) && !e.fork) {
      // Opus manages; labor runs on Sonnet 5.5 unless Opus asked for a model. Never Haiku.
      if (/haiku/i.test(e.model ?? '') || (!e.model && e.subagentType !== workerType)) input = { ...e, model: SONNET }
      if (!e.parentAgentId && !/opus/i.test(e.parentModel) && !warnedModel) {
        warnedModel = true
        $.ui.toast(`Conductor is running on ${e.parentModel}, not Opus 5.5: switch the session model for the full effect`)
      }
    }

    const r = await next(input)
    if (!r.agentId) return r

    const now = await $.clock.now()
    const taskId = taskIdIn(e.description, e.prompt)
    const row: AgentRow = {
      id: r.agentId,
      label: clip(e.description || e.name || e.subagentType, 60),
      model: r.model,
      type: e.subagentType,
      startedAt: now,
      endedAt: 0,
      status: 'running',
      tools: 0,
      doing: 'starting',
      pct: 0,
      taskId,
      summary: '',
    }
    await setAgents($, list => [...list.filter(a => a.id !== row.id), row])
    if (taskId && isLive(m)) {
      await setMission($, x =>
        x ? { ...x, tasks: x.tasks.map(t => (t.id === taskId && t.status === 'pending' ? { ...t, status: 'active', startedAt: now, agentId: row.id } : t.id === taskId ? { ...t, agentId: row.id } : t)) } : x,
      )
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const now = await $.clock.now()

    if (e.agentId) {
      const id = e.agentId
      const status = e.isAborted ? 'stopped' : e.reason === 'answer' ? 'done' : 'failed'
      await setAgents($, list =>
        list.map(a => (a.id === id ? { ...a, status, endedAt: now, pct: status === 'done' ? 100 : a.pct, doing: status === 'done' ? 'handed back to Opus' : status, summary: clip(e.answer, 220) } : a)),
      )
      return r
    }

    const m = await read($, missionAtom)
    if (!m || m.status !== 'running') return r
    const agents = await read($, agentsAtom)
    const p = progress(m, agents)
    if (p.n > 0 && p.doneN === p.n) {
      await setMission($, x => (x ? { ...x, status: 'done', endedAt: now, doing: 'done' } : x))
      $.ui.toast(`◆ Mission done in ${minutes(now - m.startedAt)}: ${clip(m.title, 60)}`)
      return r
    }

    // Autopilot: a running worker wakes Opus with its notification; otherwise nudge.
    const settings = await read($, settingsAtom)
    const working = agents.some(a => a.status === 'running')
    if (settings.auto && e.reason === 'answer' && !e.isAborted && !working && m.continues < settings.maxContinues) {
      await setMission($, x => (x ? { ...x, continues: x.continues + 1, doing: 'continuing (autopilot)' } : x))
      void $.prompt.submit({ text: continuation(m) })
    } else {
      await setMission($, x => (x ? { ...x, doing: working ? 'waiting on workers' : 'idle' } : x))
    }
    return r
  })

  // ---------- drawing ----------

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const m = await read($, missionAtom)
    const agents = await read($, agentsAtom)
    const settings = await read($, settingsAtom)
    const now = await $.clock.now()
    const width = Math.max(40, e.props.bodyColumns || 80)
    return drawPane($, table, { m, agents, settings, now, width })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const m = await read($, missionAtom)
    const now = await $.clock.now()
    const recent = !!m && m.status === 'done' && now - m.endedAt < RECENT_MS
    if (e.props.hasSurvey || !m || !(isLive(m) || recent)) return next(e)

    const below = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const agents = await read($, agentsAtom)
    const p = progress(m, agents)
    const running = agents.filter(a => a.status === 'running')
    const width = Math.max(30, e.props.bodyColumns || 80)
    const tone = m.status === 'done' ? COLOR.done : m.status === 'waiting' ? COLOR.wait : COLOR.opus
    const right = m.status === 'done' ? 'done ✓' : m.status === 'waiting' ? 'waiting on you' : m.planAt ? `${p.pct}%` : 'planning…'

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
          <Text bold wrap="truncate-end">
            <Text color={COLOR.opus}>◆ </Text>
            {m.title}
          </Text>
          <Box flexDirection="row" columnGap={2} flexShrink={0}>
            <Text bold color={tone}>{right}</Text>
            <Button key="conduct-open" label="board" hotkey="c" plain onPress={() => openPane($)} />
          </Box>
        </Box>
        {m.planAt > 0 && <Text color={tone}>{textBar(p.fraction, Math.min(width - 2, 80))}</Text>}
        <Text dimColor wrap="truncate-end">
          {running.length
            ? running.map(a => `${modelName(a.model)} ${a.pct ? a.pct + '% ' : ''}· ${a.doing}`).join('  |  ')
            : `Opus: ${m.doing}`}
        </Text>
        {below}
      </Box>
    )
  })
}

// ---------- pieces ----------

function modelName(id: string): string {
  const hit = /(opus|sonnet|haiku|fable)[-_ ]?(\d+)?(?:[-.](\d+))?/i.exec(id)
  if (!hit) return clip(id || 'inherit', 16)
  const word = hit[1] ?? ''
  const name = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  return hit[2] ? `${name} ${hit[2]}${hit[3] ? '.' + hit[3] : ''}` : name
}

function modelColor(id: string): string {
  return /opus/i.test(id) ? COLOR.opus : /sonnet/i.test(id) ? COLOR.sonnet : COLOR.track
}

function textBar(fraction: number, width: number): string {
  const w = Math.max(8, width)
  const n = Math.round(Math.max(0, Math.min(1, fraction)) * w)
  return '█'.repeat(n) + '░'.repeat(w - n)
}

function ringSvg(fraction: number, label: string, color: string): string {
  const r = 30
  const c = 2 * Math.PI * r
  const dash = (Math.max(0, Math.min(1, fraction)) * c).toFixed(1)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="76" height="76" viewBox="0 0 76 76"><circle cx="38" cy="38" r="${r}" fill="none" stroke="${COLOR.track}" stroke-opacity="0.25" stroke-width="7"/><circle cx="38" cy="38" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${dash} ${c.toFixed(1)}" transform="rotate(-90 38 38)"/><text x="38" y="43" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="16" font-weight="700" fill="${color}">${label}</text></svg>`
}

function barSvg(fraction: number, color: string, width: number): string {
  const f = Math.max(0, Math.min(1, fraction))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="8" viewBox="0 0 ${width} 8"><rect width="${width}" height="8" rx="4" fill="${COLOR.track}" fill-opacity="0.25"/><rect width="${(f * width).toFixed(1)}" height="8" rx="4" fill="${color}"/></svg>`
}

/** One segment per live task, colored by where it stands: the plan at a glance. */
function segmentsSvg(tasks: readonly Task[], width: number): string {
  const live = tasks.filter(t => t.status !== 'dropped')
  if (!live.length) return barSvg(0, COLOR.track, width)
  const gap = 3
  const w = (width - gap * (live.length - 1)) / live.length
  const rects = live
    .map((t, i) => {
      const color = t.status === 'done' ? COLOR.done : t.status === 'active' ? (t.owner === 'opus' ? COLOR.opus : COLOR.sonnet) : COLOR.track
      const opacity = t.status === 'pending' ? 0.3 : 1
      return `<rect x="${(i * (w + gap)).toFixed(1)}" width="${Math.max(2, w).toFixed(1)}" height="6" rx="3" fill="${color}" fill-opacity="${opacity}"/>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="6" viewBox="0 0 ${width} 6">${rects}</svg>`
}

function segmentsText(tasks: readonly Task[]): string {
  return tasks
    .filter(t => t.status !== 'dropped')
    .map(t => (t.status === 'done' ? '■' : t.status === 'active' ? '▣' : '□'))
    .join('')
}

type View = { m: Mission | null; agents: readonly AgentRow[]; settings: ConductorSettings; now: number; width: number }

function drawPane($: EngineInterface, table: Kit, v: View) {
  const { Box, Text, Button } = table
  const Svg = 'Svg' in table ? table.Svg : undefined
  const { m, agents, settings, now, width } = v
  const bar = (fraction: number, color: string, cols: number) =>
    Svg ? <Svg source={barSvg(fraction, color, Math.max(80, cols * 7))} alt={`${Math.round(fraction * 100)} percent`} /> : <Text color={color}>{textBar(fraction, cols)}</Text>

  const header = (() => {
    if (!m) {
      return (
        <Box flexDirection="column">
          <Text bold color={COLOR.opus}>◆ Opus Conductor</Text>
          <Text dimColor>No mission yet. Type /conduct, pick conduct (opus-conductor), and describe what done looks like. Opus 5.5 plans it, Sonnet 5.5 workers build it, and it all shows up here.</Text>
        </Box>
      )
    }
    const p = progress(m, agents)
    const left = eta(m, agents, now)
    const tone = m.status === 'done' ? COLOR.done : m.status === 'waiting' ? COLOR.wait : m.status === 'stopped' ? COLOR.track : COLOR.opus
    const word =
      m.status === 'done' ? `Done ✓ in ${minutes(m.endedAt - m.startedAt)}` : m.status === 'stopped' ? 'Stopped' : m.status === 'waiting' ? 'Waiting on you' : m.planAt ? `${p.doneN} of ${p.n} tasks done` : 'Planning…'
    const meta = [
      m.status === 'running' || m.status === 'waiting' ? `⏱ ${minutes(now - m.startedAt)}` : '',
      left !== null ? `~${minutes(left)} left` : '',
      settings.auto ? `autopilot ${m.continues}/${settings.maxContinues}` : 'autopilot off',
    ].filter(Boolean)
    const live = m.status === 'running' || m.status === 'waiting'
    return (
      <Box flexDirection="column" rowGap={0}>
        <Box flexDirection="row" columnGap={2} alignItems="center">
          {Svg && <Svg source={ringSvg(p.fraction, `${p.pct}%`, tone)} alt={`Mission ${p.pct} percent done`} width={76} height={76} />}
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text bold color={COLOR.opus}>◆ OPUS CONDUCTOR</Text>
            <Text bold wrap="wrap">{m.title}</Text>
            <Text color={tone} bold>{Svg ? word : `${p.pct}% · ${word}`}</Text>
          </Box>
        </Box>
        {m.planAt > 0 &&
          (Svg ? (
            <Svg source={segmentsSvg(m.tasks, Math.max(120, Math.min(width, 90) * 7))} alt={`${p.doneN} of ${p.n} tasks done`} />
          ) : (
            <Text color={tone}>{segmentsText(m.tasks)}</Text>
          ))}
        <Text dimColor wrap="truncate-end">{meta.join('  ·  ')}</Text>
        {live && (
          <Text wrap="truncate-end">
            <Text color={COLOR.opus} bold>Opus 5.5 </Text>
            <Text dimColor>{m.status === 'waiting' ? `asks: ${m.note}` : m.doing}</Text>
          </Text>
        )}
      </Box>
    )
  })()

  const running = agents.filter(a => a.status === 'running')
  const finished = agents.filter(a => a.status !== 'running').reverse()
  const shownFinished = finished.slice(0, 5)

  const runningCard = (a: AgentRow) => {
    const tone = modelColor(a.model)
    return (
      <Box flexDirection="column" key={`agent-${a.id}`} borderStyle="round" borderColor={tone} paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
          <Text wrap="truncate-end">
            <Text color={tone}>● </Text>
            <Text bold color={tone}>{modelName(a.model)} </Text>
            <Text bold>{a.label}</Text>
          </Text>
          <Text dimColor>{`${minutes(now - a.startedAt)} · ${a.tools} tools`}</Text>
        </Box>
        <Box flexDirection="row" columnGap={1} alignItems="center">
          {bar(a.pct / 100, tone, Math.min(24, Math.max(8, width - 30)))}
          <Text dimColor>{a.pct ? `${a.pct}%` : 'working…'}</Text>
        </Box>
        <Text dimColor wrap="truncate-end">{`▸ ${a.doing}`}</Text>
      </Box>
    )
  }

  const finishedRow = (a: AgentRow) => {
    const icon = a.status === 'done' ? '✓' : a.status === 'failed' ? '✗' : '■'
    const tone = a.status === 'done' ? COLOR.done : a.status === 'failed' ? COLOR.fail : COLOR.track
    return (
      <Box flexDirection="row" justifyContent="space-between" columnGap={1} key={`agent-${a.id}`}>
        <Text wrap="truncate-end">
          <Text color={tone}>{icon} </Text>
          <Text color={modelColor(a.model)}>{modelName(a.model)} </Text>
          <Text dimColor>{a.label}</Text>
        </Text>
        <Text dimColor>{`${minutes(a.endedAt - a.startedAt)} · ${a.tools} tools`}</Text>
      </Box>
    )
  }

  const taskRow = (t: Task) => {
    const icon = t.status === 'done' ? '✓' : t.status === 'active' ? '▶' : t.status === 'dropped' ? '×' : '○'
    const tone = t.status === 'done' ? COLOR.done : t.status === 'active' ? (t.owner === 'opus' ? COLOR.opus : COLOR.sonnet) : COLOR.track
    return (
      <Text wrap="truncate-end" key={`task-${t.id}`}>
        <Text color={tone}>{icon} </Text>
        <Text dimColor>{`#${t.id} ${t.size} `}</Text>
        <Text color={t.owner === 'opus' ? COLOR.opus : COLOR.sonnet}>{t.owner === 'opus' ? 'Opus  ' : 'Sonnet'} </Text>
        <Text bold={t.status === 'active'} dimColor={t.status === 'done' || t.status === 'dropped'} strikethrough={t.status === 'dropped'}>{t.title}</Text>
      </Text>
    )
  }

  // the plan keeps what's moving in view: the last two done, then everything open
  const plan = (() => {
    if (!m) return null
    const done = m.tasks.filter(t => t.status === 'done')
    const hiddenDone = Math.max(0, done.length - 2)
    const keep = new Set(done.slice(-2).map(t => t.id))
    const rows = m.tasks.filter(t => t.status !== 'done' || keep.has(t.id))
    return { hiddenDone, rows }
  })()

  const live = !!m && (m.status === 'running' || m.status === 'waiting')

  return (
    <Box flexDirection="column" rowGap={1}>
      {header}
      <Box flexDirection="column" rowGap={0}>
        <Text bold>{`AGENTS  ${running.length} working · ${finished.length} done`}</Text>
        {!agents.length && <Text dimColor>No agents launched yet.</Text>}
        {running.map(runningCard)}
        {shownFinished.map(finishedRow)}
        {finished.length > shownFinished.length && <Text dimColor>{`+${finished.length - shownFinished.length} earlier`}</Text>}
      </Box>
      {m && plan && (
        <Box flexDirection="column">
          <Text bold>PLAN</Text>
          {!m.tasks.length && <Text dimColor>Waiting for Opus to plan…</Text>}
          {plan.hiddenDone > 0 && <Text color={COLOR.done} dimColor>{`✓ ${plan.hiddenDone} earlier tasks done`}</Text>}
          {plan.rows.map(taskRow)}
        </Box>
      )}
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        {live && (
          <Button
            key="conduct-stop"
            label="Stop mission"
            onPress={async () => {
              const at = await $.clock.now()
              await update($, missionAtom, x => (x ? { ...x, status: 'stopped' as const, endedAt: at } : x))
            }}
          />
        )}
        <Button
          key="conduct-auto"
          label={settings.auto ? 'Autopilot: on' : 'Autopilot: off'}
          onPress={async () => {
            const next = await update($, settingsAtom, s => ({ ...s, auto: !s.auto }))
            await $.store.set('settings', next).catch(() => undefined)
          }}
        />
        {!live && (m || agents.length > 0) && (
          <Button
            key="conduct-clear"
            label="Clear board"
            onPress={async () => {
              await update($, missionAtom, () => null)
              await update($, agentsAtom, list => (list ?? []).filter(a => a.status === 'running'))
            }}
          />
        )}
      </Box>
    </Box>
  )
}
