# Summon under Rex

Summon detects the terminal that runs it. Inside a Rex terminal (or with Rex installed and
Ghostty absent) a workspace is one Rex session named after the project, with one block per
pane. This page records the contracts that differ from Ghostty; Phase 6 of the Rex plan
completes it.

## `summon clean <project>`

`summon clean <project>` closes the project's recorded Rex session only when Summon's own
check (`session.view`) shows it empty: no blocks at all. It refuses with exit 2 when the
session cannot be verified (server unreachable) or still has panes, naming the recorded
panes and counting unrecorded blocks. The check runs twice, the second time immediately
before the close, to keep the window small.

Rex has no conditional destroy. Anything added to the session between the second check and
`session.destroy` is closed with it; the command says so in its output. After the close,
Summon saves a snapshot, marks the record as ended and removes this launch's files, in that
order, under the status lock; a step that fails is reported and retried on the next status
read.

`summon clean --orphans <project>` reviews every earlier launch of the project: launches whose
session the server confirms gone have their files removed; empty sessions are closed and
their files removed; sessions that still have blocks are left alone with the exact `rex kill`
command printed; launches that never confirmed their session, or left an unreadable pane
file, are printed with the exact `rm` command and never deleted automatically.
