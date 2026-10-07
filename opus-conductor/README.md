# opus-conductor

Opus 5.5 is the thinker, manager and integrator. Sonnet 5.5 workers do the hard labor. It's the SOL orchestrator idea (Sol → Opus, Luna → Sonnet) with a /goal-style live board.

- `/conduct <what done looks like>` starts a mission. Opus plans sized tasks, delegates to `opus-conductor:worker` (Sonnet 5.5), verifies and integrates.
- `/conduct` opens the board. Other commands: `/conduct stop`, `/conduct auto on|off` and `/conduct clear`.
- Board: a progress ring, every agent with its model, its live activity and its self-reported %, and the plan. There's also a band above the prompt (`c` opens the board) and a status line.
- During a mission, subagents set to Haiku or with no model set run on Sonnet 5.5. Autopilot nudges Opus to continue, at most 8 times, while tasks are open and no worker is running.

Edit here, then run `/reload-plugins`. Tests: `claude plugin test .`
