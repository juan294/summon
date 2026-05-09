---
name: "macOS Development"
description: "macOS-specific patterns: launchd agent configuration, brew vs pip, zsh regex quirks, file descriptor limits."
---

# macOS Development

## pip on macOS

Wrong -- system pip blocked on Python 3.12+ (PEP 668):

```bash
pip3 install some-tool  # externally-managed-environment
```

Right -- use Homebrew or pipx:

```bash
brew install some-tool
pipx install some-python-app
```

## zsh Regex and Special Characters

Wrong -- complex regex in zsh triggers parse errors:

```bash
grep -oP '(?<=version":")[^"]+' package.json
# zsh: event not found
```

Right -- use built-in Grep tool, or wrap in bash:

```bash
bash -c 'grep -oP '"'"'(?<=version":")[^"]+'"'"' package.json'
```

## launchd Agent Configuration

Wrong -- run script directly (crashes if dir has .claude/):

```xml
<key>ProgramArguments</key>
<array>
  <string>/project/scripts/agent.sh</string>
</array>
```

Right -- bash wrapper + resource limits + environment vars:

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

## launchd Testing

Wrong -- test from terminal (masks launchd-specific failures):

```bash
./scripts/agent.sh  # works in terminal, fails silently under launchd
```

Right -- test with launchctl:

```bash
launchctl start com.yourorg.agent
launchctl list | grep yourorg  # check actual exit status
```
