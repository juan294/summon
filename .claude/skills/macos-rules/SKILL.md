---
name: "macos-rules"
description: "macOS-specific patterns: launchd agent configuration, brew vs pip, zsh regex quirks, file descriptor limits."
---

# macOS Development

## pip on macOS

Respect externally managed Python environments (PEP 668). For a required CLI,
prefer its verified Homebrew formula or use pipx for a verified Python app.
For project libraries, use the project's virtual environment and declared
requirements.

Before installing, verify the exact package name and publisher against the
intended tool's official documentation. Never install a literal placeholder
from an example or infer a package name from a tool's display name. Use the
approved private registry for internal packages.

## zsh Regex and Special Characters

Shell quoting and executable capabilities are separate. Single-quoted
patterns pass literally to bash and zsh. macOS BSD grep does not support
`-P`; wrapping it in `bash -c` does not add PCRE support.

For JSON, parse JSON:

```bash
python3 -c 'import json; print(json.load(open("package.json"))["version"])'
```

For plain text use `rg`, a supported `grep -E` pattern, or Python `re`.
Discover which executable is installed and check its help before using
nonportable flags. Use a script for complex parsing.

## launchd Agent Configuration

Historical sessions reported a location-dependent Claude CLI failure under
launchd, with an unrecorded client version. That observation does not establish
that all direct script launches crash or that current clients need a wrapper.
For a reproduced failure, capture client/macOS versions, arguments, cwd,
resource limits and sanitized logs before selecting a workaround.

The following is the historical wrapper recipe; choose limits and environment
from the actual job requirements rather than treating these numbers as native
minimums. Installing or starting a scheduled job is an explicit opt-in.

Historical wrapper, resource-limit and environment example:

```xml
<key>ProgramArguments</key>
<array>
  <string>/bin/bash</string>
  <string>-c</string>
  <string>exec /bin/bash /project/scripts/agent.sh</string>
</array>
<key>HardResourceLimits</key>
<dict><key>NumberOfFiles</key><integer>122880</integer></dict>
<key>SoftResourceLimits</key>
<dict><key>NumberOfFiles</key><integer>122880</integer></dict>
<key>EnvironmentVariables</key>
<dict>
  <key>HOME</key><string>/Users/you</string>
  <key>TERM</key><string>xterm-256color</string>
  <key>PATH</key><string>/usr/local/bin:/usr/bin:/bin</string>
</dict>
```

Scheduled jobs need authentication that works without interactive prompts.
Inspect the installed client's supported authentication setup; a previously
configured session may already work. `claude setup-token` is one supported
setup route, not proof that every job must create a new token. Never print
credentials or launch an inference probe without the relevant authorization.

## launchd Testing

Terminal execution alone does not verify the scheduler environment:

```bash
./scripts/agent.sh  # works in terminal, fails silently under launchd
```

For an explicitly authorized scheduled-job test, inspect launchctl and logs:

```bash
launchctl start com.yourorg.agent
launchctl list | grep yourorg  # exit code shows 0 even on crash -- check logs, not just this
```

A historical failure returned zero despite an error. Check job logs and the
expected output as well as status; a successful launch request is not evidence
that the agent task completed.
