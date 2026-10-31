# Ghostty compatibility and workflows

Summon supports Ghostty 1.3.1 and later on macOS. Ghostty 1.4.0 is the recommended security baseline. Run `summon doctor` to see the installed version, detected capabilities and effective configuration.

Summon also runs workspaces in Rex (beta). The backend is detected from the terminal that runs `summon`, so nothing on this page changes when Ghostty is the terminal in use; what differs under Rex (detection, session and pane mapping, already-running behavior, `summon clean`, per-launch files) is documented in [Summon under Rex](rex.md).

## Compatibility

| Runtime | Behavior | Validation |
|---|---|---|
| Ghostty 1.3.1 | Existing workspace launches remain supported. Doctor recommends upgrading; newer actions require their actual capabilities. | Compatibility fixtures cover older CLI/dictionary behavior and launch defaults. A native 1.3.1 runtime was unavailable; it has not been tested here. |
| Ghostty 1.4.0 | Supports native pane observations, title overrides, optional tab detachment and `+ssh`, subject to capability checks. Visibility reporting is negotiated with the terminal. | Native macOS fixtures cover exact focus, observations, title read/set/reset, detachment and visibility/mode restoration. |
| Missing application or unavailable probe | Doctor reports FAIL or UNAVAILABLE with recovery guidance. Explicit native commands cannot claim success without a confirmed target and capability. | Missing, malformed, denied and timeout cases have regression coverage. |

Capabilities come from the installed scripting dictionary, action list and terminal replies. A version number alone does not establish support or permission. New explicit commands return 0 on success, 1 for invalid usage/input, and 2 for an unavailable target or capability.

## Diagnose effective configuration

```bash
summon doctor
summon doctor --verbose
summon doctor --fix
```

Doctor reads effective configuration through Ghostty's CLI, including defaults. An absent setting in your config file can already have the recommended effective value. The report includes shell integration, command notifications, scrollback compression, hyperlinks, clipboard access, window resizing and screen-checksum reporting. Security preferences are advisory; doctor does not change those protections automatically or print the full environment/configuration.

`--fix` can append the existing shell-integration and notification recommendations only when their effective values need correction, their keys are absent from an existing writable target, and the configuration source is unambiguous. It backs up the file and reads the effective configuration again. It preserves explicit values, including deliberate disablement. Includes, another configuration source, unavailable evidence or a missing target require manual review/edit/reload instead of speculative writes.

An upgrade warning alone does not fail the command. Unresolved failures or unavailable diagnostic evidence return exit code 2, including command, permission and port failures that remain after a configuration fix. Repair the reported cause and run doctor again; probe failures are retried on the next invocation.

When System Events does not answer the Accessibility check within 2 seconds, doctor prints `Accessibility permission could not be checked (System Events did not answer); a launch will report it if it is missing` as INFO, which is neither a pass nor a failure. A launch also goes on in that case, and a real denial is reported when the workspace script runs. A check that answers with a denial still stops the launch before any window opens.

When a launch fails, Summon closes only what that launch created: the window opened by `--new-window` or the tab opened by `--new-tab`, found by its id. It never closes your own front window. A launch into an existing window closes nothing, and any splits it already added there stay, so close them by hand.

## Inspect and focus existing panes

```bash
summon inspect myapp
summon inspect myapp --json
summon focus myapp
summon focus myapp shell
```

`inspect` reads stored workspace state and current per-pane terminal ID, title, foreground PID and TTY without activating Ghostty. An unavailable foreground PID/TTY is `null` in JSON. These are observations; the root-shell marker/PID still determines workspace liveness.

New launches capture exact native terminal IDs. `focus myapp` selects the recorded root; an optional pane name selects that exact recorded pane. Use `inspect` to find valid names. Native IDs last for the lifetime of their surfaces, not across closure or application restarts. Focus resolves the containing tab/window at the time of the action, so a moved pane can still be selected.

Old status records remain readable but may lack native identity. Closed panes, legacy records or unavailable permissions produce guidance and exit 2; focus never guesses by title/directory or automatically launches another workspace. Select the workspace in Ghostty, or explicitly relaunch when you are ready to capture fresh identity. For permission failures, run doctor and review System Settings > Privacy & Security > Automation and Accessibility.

`summon open myapp` and its alias `summon switch myapp` act on that project directly: a running workspace is focused, a stopped one launches, and one whose liveness cannot be read is refused with the reason (exit 2). Without a name both show an interactive picker. Selecting an active row focuses its recorded root; selecting a stopped row launches it. The status dashboard uses the same active/stopped distinction for Enter. Use `summon focus myapp` for a direct named target, or `summon myapp` for an explicit launch.

## Read, set and reset titles

```bash
summon title myapp
summon title myapp --set 'API development'
summon title myapp --reset
summon title myapp shell --set 'Remote shell'
summon title myapp shell --reset
```

Without a pane argument, title commands target the tab currently containing the recorded root. With a pane argument, they target that pane. Reading shows the override, or `(no title override)` when it is empty. Reset clears the override and lets Ghostty choose the title again. Project names and stored pane keys remain unchanged.

Titles accept ordinary Unicode and emoji up to 256 codepoints. Empty `--set`, control characters and bidi override/isolate characters are rejected; use `--reset` to clear an override. `--set` and `--reset` are mutually exclusive.

A mutation is confirmed by reading the resulting override. If the outcome is unknown after a timeout, read the title before retrying; Summon does not automatically repeat the mutation. Unsupported properties and missing targets exit 2 without a guessed selection.

## Optional detach binding

```bash
summon keybindings --detach-tab
summon keybindings --vim --detach-tab
```

These commands print the normal navigation snippet with one additional binding:

```ini
keybind = summon-nav:n = move_tab_to_new_window
```

After installing the snippet and its activation binding in your Ghostty config, `n` in `summon-nav` moves the whole current tab to a new window. This does not detach one pane. The command checks action support before printing a snippet and never edits global configuration. Without `--detach-tab`, generated output remains unchanged. Drag handles remain a separate user preference.

## Visibility-aware status monitor

The interactive monitor negotiates terminal visibility reports. A reported hidden state pauses regular status reads, PID/Git work and frames while input remains responsive. A visible report refreshes the current state immediately. Unknown visibility is treated as visible.

If reporting is unsupported or replies are lost, the monitor returns to normal three-second polling and displays a fallback notice. A bounded watchdog also recovers from a lost visible report. Help/error overlays are not dismissed by protocol replies, and leaving the monitor restores the visibility mode it changed.

To use ordinary polling explicitly:

```bash
SUMMON_NO_VISIBILITY=1 summon status
```

`status --once` and non-TTY output do not negotiate visibility. Regular status refreshes, briefing and ports do not query the native pane inventory; native actions run on demand.

Validation distinguishes deterministic behavior from native observations. A 30-second controlled test verifies zero new status reads, Git subprocesses and frames after existing fetches settle while hidden. A native minimize/restore trace also showed no frames during a reported hidden interval of 1.722 seconds; duration is informational, and no minimum hidden duration is assumed. Background tabs have reported conservative visible state in some native contexts and hidden state in others, so tab selection alone does not guarantee work suppression. These checks are not CPU or battery benchmarks.

## Opt-in SSH pane recipes

Ghostty 1.4 adds `ghostty +ssh`. Summon passes this explicit pane command through its existing command handling; it does not replace ordinary `ssh` commands automatically. `dev-host` below is an example SSH alias, not a host contacted during validation.

For a local editor, plain sidebar and remote shell pane, put this in the project's `.summon`:

```ini
layout=cli
editor=vi
sidebar=
shell=ghostty +ssh -- dev-host
```

When Ghostty's CLI is absent from PATH, use this shell command instead:

```ini
shell=env '/Applications/Ghostty.app/Contents/MacOS/ghostty' +ssh -- dev-host
```

The existing command resolver looks up the first executable by name. `env` allows the quoted bundle path to remain an argument; a quoted absolute bundle path as the first `.summon` executable is not supported. Use the installed bundle path shown by `summon doctor --verbose` if your application lives elsewhere.

For a tree layout, create the named layout file `~/.config/summon/layouts/ssh-dev`:

```ini
tree=editor | remote / shell
pane.editor=vi
pane.remote=ghostty +ssh -- dev-host
pane.shell=
```

Then select it in the project's `.summon`:

```ini
layout=ssh-dev
```

This creates an editor on the left and remote/plain-shell panes stacked on the right. Every bare name has a definition; the empty `pane.shell=` deliberately opens a plain shell. Tree definitions belong in the named layout file, not directly in `.summon`. For the bundle fallback, replace the remote definition with:

```ini
pane.remote=env '/Applications/Ghostty.app/Contents/MacOS/ghostty' +ssh -- dev-host
```

Review the project configuration and any named layout before trusting or launching them. Trust records the exact project `.summon` contents; editing that file requires renewed trust. Preview without opening a connection or writing workspace status artifacts:

```bash
summon trust .
summon . --dry-run
```

### Remote setup and fallback

The installed `ghostty +ssh --help` describes two default setup steps: request forwarding of `COLORTERM`, `TERM_PROGRAM` and `TERM_PROGRAM_VERSION`, and install Ghostty's terminfo entry on the remote host using `tic`. Successful terminfo installation is cached. Environment forwarding requires the remote server to accept those variables, for example with:

```text
AcceptEnv COLORTERM TERM_PROGRAM TERM_PROGRAM_VERSION
```

To skip terminfo installation while retaining environment forwarding:

```ini
shell=ghostty +ssh --terminfo=false -- dev-host
```

In this case the remote session uses `TERM=xterm-256color`. If a terminfo install fails, Ghostty prints a warning and continues with that fallback. Disabling both setup steps leaves `TERM` unchanged:

```ini
shell=ghostty +ssh --terminfo=false --forward-env=false -- dev-host
```

These are ordinary remote shell sessions. They do not provide reconnect or remote-session persistence. The recipes are validated through parsing and dry-run generation; validation does not establish an SSH connection or change a remote host.

## Inherited terminal improvements

Ghostty upgrades can improve terminal rendering, I/O, resizing and scrollback behavior independently of Summon. Retain default scrollback compression unless your workload provides a reason to change it; compression is not a reason to configure unlimited history or increase pane defaults. Summon has not attributed a CPU/battery percentage to this integration or changed launch delays on that basis.
