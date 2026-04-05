# Feature Manifest

Generated: 2026-04-05T04:31:02.522Z
Variant: stable

## Core

| Flag | Enabled | Description |
|------|---------|-------------|
| `interactiveRepl` | ✓ | Interactive terminal REPL |
| `headlessMode` | ✓ | Headless / print mode for scripting |
| `sdkProtocol` | ✓ | SDK streaming event protocol |
| `resumeContinue` | ✓ | Session resume and continue |
| `configLayering` | ✓ | Multi-source configuration |
| `repoInstructions` | ✓ | Repository instruction loading (AGENTS.md-first) |
| `trustPermissions` | ✓ | Trust and permission gating |

## Beta

| Flag | Enabled | Description |
|------|---------|-------------|
| `worktreeFlows` | ✗ | Git worktree-based workflows |
| `backgroundSessions` | ✗ | Background session utilities |
| `setupHooks` | ✗ | Setup/session-start hooks |

## Runtime-optional

| Flag | Enabled | Description |
|------|---------|-------------|
| `webFetch` | ✗ | WebFetch tool for HTTP requests |
| `webSearch` | ✗ | WebSearch tool for internet queries |
| `notebookEdit` | ✗ | Jupyter notebook editing support |

## Deferred

| Flag | Enabled | Description |
|------|---------|-------------|
| `forkSession` | ✗ | Fork a session into a new branch |
| `pointInTimeResume` | ✗ | Resume to a specific point in transcript |
| `rewindFiles` | ✗ | Rewind file state to a previous point |

## Dropped

| Flag | Enabled | Description |
|------|---------|-------------|
| `bridgeRemote` | ✗ | Bridge/remote-control flows |
| `daemonWorker` | ✗ | Daemon/worker process flows |
| `sshDirectConnect` | ✗ | SSH/direct-connect entry paths |
| `environmentRunner` | ✗ | Self-hosted environment runner |

