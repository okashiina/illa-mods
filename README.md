# illa-mods

illa's Claude Code mods, as a plugin marketplace.

| Plugin | What it does |
| --- | --- |
| [opus-conductor](opus-conductor/README.md) | Opus 5.5 conducts and Sonnet 5.5 workers build, with a live board of agents and mission % (`/opus-conductor:conduct`) |

## Install

You need Claude Code 2.1.289 or newer (function-hook plugins).

From a git repo of this folder:

```bash
claude plugin marketplace add <github-user>/illa-mods
claude plugin install opus-conductor@illa-mods
```

From a local copy (a zip unpacked anywhere):

```bash
claude plugin marketplace add "C:\path\to\illa-mods"
claude plugin install opus-conductor@illa-mods
```

Then restart Claude Code, or run `/reload-plugins` in an open session.
