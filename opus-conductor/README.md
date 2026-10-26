# opus-conductor

Opus 5.5 is the thinker, manager and integrator. Sonnet 5.5 workers do the hard labor, and Haiku 5.5 scouts do fast, narrow jobs. It's the SOL orchestrator idea (Sol → Opus, Luna → Sonnet) with a `/goal`-style live board.

## Install

```
/plugin install opus-conductor --marketplace okashiina/illa-mods
```

On older Claude Code: `/plugin marketplace add okashiina/illa-mods`, then `/plugin install opus-conductor@illa-mods`. Restart or run `/reload-plugins`. Update later with `claude plugin update opus-conductor@illa-mods`.

## Use

| Type | Does |
| --- | --- |
| `/opus-conductor:conduct <what done looks like>` | Starts a mission. Opus plans sized tasks, picks a helper and a reasoning effort for each, delegates, then verifies and integrates. |
| `/opus-conductor:conduct` | Opens the live board. |
| `/opus-conductor:conduct stop` · `auto on` · `auto off` · `clear` | Stops the mission, toggles autopilot, or clears the board. |
| mission tool action `hold` (Opus calls it) | Opus is waiting on something outside the session: a render, CI, a background command. Autopilot stays quiet until a task notification, you, or its timer wakes it. |

In the desktop app, type `/conduct` and pick **conduct (opus-conductor)** from the menu.

- **Board:** a progress ring, every agent with its model, its live activity and its self-reported %, and the task plan. There's also a band above the prompt (`c` opens the board) and a status line.
- **Who does what:**

  | Model | Role | Gets |
  | --- | --- | --- |
  | Opus 5.5 | conductor | Architecture, design, diagnosis, security, integration, review. |
  | Sonnet 5.5 | worker | Implementation, refactors, tests, multi-step debugging, agentic coding. |
  | Haiku 5.5 | scout | Lookups, file and log sweeps, extraction, summaries, triage, running a check and reporting it, browser checks. |

  Haiku 5.5 costs $0.10 / $0.50 per MTok for prompts up to 100K tokens. It is strong at narrow work (OSWorld 72%) but well behind Sonnet on complex agentic coding (Terminal-Bench 4.0: 39% vs 71%), so it never gets design or hard coding. Its cyber safeguards also block pentest-style work.
- **Reasoning effort, picked per task by Opus:** the Agent tool can't set effort per call, so there is one agent type per effort.

  | Effort | `opus-conductor:worker-*` (Sonnet 5.5) | `opus-conductor:scout-*` (Haiku 5.5) |
  | --- | --- | --- |
  | `low` | mechanical edits from an exact spec | single lookups, greps, one value, one named check |
  | `medium` | clear-brief implementation (the default for agentic coding) | summaries, triage, extraction across several files |
  | `high` | nontrivial implementation, cross-module refactors, tricky tests, bounded debugging | careful cross-checks, browser flows, costly-if-wrong sweeps |
  | `xhigh` | hard multi-step debugging, long multi-file builds where a miss is costly | not offered |

  Opus starts workers at `medium` and scouts at `low`. It raises one level for each thing that makes a task harder: unfamiliar code, subtle invariants, many interacting files, a fix that must hold under tests. It lowers one level for repetitive work. Task size alone never raises effort. Plan tasks record their effort, and the board shows it on each task and agent. Opus's own effort is the session's setting.
- **Model steering during a mission:**
  - Subagents with no model set run on Sonnet 5.5.
  - Explore agents run on Haiku 5.5.
  - Any older Haiku request is lifted to Haiku 5.5.
  - An explicit Opus or Sonnet choice is kept.
- **Autopilot:** it nudges Opus to continue, at most 8 times, while tasks are open and no worker is running. Opus can pause it to ask you a question (`wait`) or to wait on the outside world (`hold`).
- **No nudge spam (1.5):** autopilot never asks twice for nothing.
  - `hold`: Opus says what it waits on and, optionally, after how many minutes to check again. While work goes on (agents running, a background task, the outside job), the board says "cooking" with a spinner. Only a stall with nothing running says "standing by · 12m left".
  - Stall detection: a nudged turn that changed nothing on the board (no task moved, no agent started, no file written) puts the mission on hold for 5 min, doubling per stall in a row up to 30 min, instead of nudging again.
  - Background work: a turn in which Opus started a background command or a monitor is held too, since its notification wakes the session.
  - Waking: a task notification, a peer message, a scheduled trigger, or you typing resumes the mission at once. The timer wakes Opus once with "check whether it's ready; if not, hold again". The board has a "Resume now" button.
  - Your message also resets the stall count and the autopilot budget.
- **Live bars (1.6):** each agent's bar moves with every tool call. Before its first report it shows an estimate from its tool calls (`~14%`), and after a report it creeps up until the next one. A task whose agent handed back counts 90% until Opus verifies it, and active plan segments fill with their agent's %.
- **Session model:** run the session on Opus 5.5 for the intended split. If it isn't, the board shows a warning when Opus first hands off a task.

## Develop

- Run `claude plugin validate .` and `claude plugin test .` in this folder.
- An installed copy is read from this folder. After editing, run `/reload-plugins` in a session to pick up the changes.
- Develop risky changes on a copy with `claude --plugin-dir <copy>` so running sessions are untouched.
