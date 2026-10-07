# opus-conductor

Opus 5.5 is the thinker, manager and integrator. Sonnet 5.5 workers do the hard labor. It's the SOL orchestrator idea (Sol → Opus, Luna → Sonnet) with a `/goal`-style live board.

## Use

| Type | Does |
| --- | --- |
| `/opus-conductor:conduct <what done looks like>` | Starts a mission. Opus plans sized tasks, delegates to `opus-conductor:worker` (Sonnet 5.5), verifies and integrates. |
| `/opus-conductor:conduct` | Opens the live board. |
| `/opus-conductor:conduct stop` · `auto on` · `auto off` · `clear` | Stops the mission, toggles autopilot, or clears the board. |

In the desktop app, type `/conduct` and pick **conduct (opus-conductor)** from the menu.

- **Board:** a progress ring, every agent with its model, its live activity and its self-reported %, and the task plan. There's also a band above the prompt (`c` opens the board) and a status line.
- **Models:** during a mission, subagents set to Haiku or with no model set run on Sonnet 5.5.
- **Autopilot:** it nudges Opus to continue, at most 8 times, while tasks are open and no worker is running. Opus can pause it to ask you a question.
- **Session model:** run the session on Opus 5.5 for the intended split. If it isn't, the board shows a warning when Opus first hands off a task.

## Develop

- Run `claude plugin validate .` and `claude plugin test .` in this folder.
- An installed copy is read from this folder. After editing, run `/reload-plugins` in a session to pick up the changes.
- Develop risky changes on a copy with `claude --plugin-dir <copy>` so running sessions are untouched.
