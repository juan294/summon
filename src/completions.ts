import { getPresetNames } from "./layout.js";
import { VALID_KEYS, CLI_FLAGS, BOOLEAN_KEYS } from "./config.js";

export function generateZshCompletion(): string {
  const presetNames = getPresetNames().join(" ");
  const configKeys = VALID_KEYS.join(" ");
  const booleanKeyCheck = [...BOOLEAN_KEYS].map(k => `"\\$\{words[2]}" == "${k}"`).join(" || ");

  return `#compdef summon

_summon() {
  local -a subcommands=(
    'add:Register a project'
    'remove:Remove a project'
    'list:List registered projects'
    'set:Set a config value'
    'config:Show current config'
    'setup:Interactive setup wizard'
    'completions:Generate shell completions'
    'doctor:Check Ghostty config'
    'open:Select and launch a project'
    'export:Export config as .summon file'
  )

  local -a config_keys=(${configKeys})
  local -a layout_presets=(${presetNames})
  local projects_file="\${HOME}/.config/summon/projects"

  # Read project names dynamically
  local -a project_names=()
  if [[ -f "$projects_file" ]]; then
    project_names=(\${(f)"$(cut -d= -f1 "$projects_file")"})
  fi

  _arguments -C \\
    '(-h --help)'{-h,--help}'[Show help]' \\
    '(-v --version)'{-v,--version}'[Show version]' \\
    '(-l --layout)'{-l,--layout}'[Layout preset]:preset:(${presetNames})' \\
    '(-e --editor)'{-e,--editor}'[Editor command]:command:' \\
    '(-p --panes)'{-p,--panes}'[Editor panes]:count:' \\
    '--editor-size[Editor width %]:percent:' \\
    '(-s --sidebar)'{-s,--sidebar}'[Sidebar command]:command:' \\
    '--shell[Shell pane]:value:(true false)' \\
    '--auto-resize[Enable auto-resize]' \\
    '--no-auto-resize[Disable auto-resize]' \\
    '--starship-preset[Starship preset]:preset:->starship_preset' \\
    '*--env[Set environment variable]:var:' \\
    '--font-size[Font size in points]:size:' \\
    '--on-start[Run command before workspace creation]:command:' \\
    '--new-window[Open in new Ghostty window]' \\
    '--fullscreen[Start in fullscreen mode]' \\
    '--maximize[Start maximized]' \\
    '--float[Float window on top]' \\
    '(-n --dry-run)'{-n,--dry-run}'[Dry run]' \\
    '1: :->cmd' \\
    '*::arg:->args'

  case "$state" in
    starship_preset)
      local -a starship_presets
      starship_presets=(\${(f)"$(starship preset --list 2>/dev/null)"})
      compadd -a starship_presets
      return
      ;;
    cmd)
      _describe 'command' subcommands
      compadd -a project_names
      _files -/
      ;;
    args)
      case "\${words[1]}" in
        remove)
          compadd -a project_names
          ;;
        set)
          if (( CURRENT == 2 )); then
            compadd -a config_keys
          elif [[ "\${words[2]}" == "layout" ]]; then
            compadd -a layout_presets
          elif [[ ${booleanKeyCheck} ]]; then
            compadd true false
          elif [[ "\${words[2]}" == "starship-preset" ]]; then
            local -a sp=(\${(f)"$(starship preset --list 2>/dev/null)"})
            compadd -a sp
          fi
          ;;
        add)
          if (( CURRENT == 3 )); then
            _directories
          fi
          ;;
        completions)
          if (( CURRENT == 2 )); then
            compadd zsh bash
          fi
          ;;
      esac
      ;;
  esac
}

compdef _summon summon
`;
}

export function generateBashCompletion(): string {
  const configKeys = VALID_KEYS.join(" ");
  const presetNames = getPresetNames().join(" ");
  const flagsList = CLI_FLAGS.join(" ");
  const booleanKeyCheck = [...BOOLEAN_KEYS].map(k => `"\\$\{words[2]}" == "${k}"`).join(" || ");

  return `_summon() {
  local cur prev words cword
  _init_completion || return

  local subcommands="add remove list set config setup completions doctor open export"
  local config_keys="${configKeys}"
  local layout_presets="${presetNames}"
  local projects_file="\${HOME}/.config/summon/projects"

  local project_names=""
  if [[ -f "$projects_file" ]]; then
    project_names=$(cut -d= -f1 "$projects_file")
  fi

  # Complete flags
  case "$prev" in
    -l|--layout)
      COMPREPLY=($(compgen -W "$layout_presets" -- "$cur"))
      return ;;
    --shell)
      COMPREPLY=($(compgen -W "true false" -- "$cur"))
      return ;;
    --starship-preset)
      local sp
      sp=$(starship preset --list 2>/dev/null)
      COMPREPLY=($(compgen -W "$sp" -- "$cur"))
      return ;;
    completions)
      COMPREPLY=($(compgen -W "zsh bash" -- "$cur"))
      return ;;
  esac

  if [[ "$cur" == -* ]]; then
    COMPREPLY=($(compgen -W "${flagsList}" -- "$cur"))
    return
  fi

  # First positional: subcommands + project names + directories
  if (( cword == 1 )); then
    COMPREPLY=($(compgen -W "$subcommands $project_names" -- "$cur"))
    COMPREPLY+=($(compgen -d -- "$cur"))
    return
  fi

  # Context-specific completions
  case "\${words[1]}" in
    remove)
      COMPREPLY=($(compgen -W "$project_names" -- "$cur"))
      ;;
    set)
      if (( cword == 2 )); then
        COMPREPLY=($(compgen -W "$config_keys" -- "$cur"))
      elif [[ "\${words[2]}" == "layout" ]]; then
        COMPREPLY=($(compgen -W "$layout_presets" -- "$cur"))
      elif [[ ${booleanKeyCheck} ]]; then
        COMPREPLY=($(compgen -W "true false" -- "$cur"))
      elif [[ "\${words[2]}" == "starship-preset" ]]; then
        local sp
        sp=$(starship preset --list 2>/dev/null)
        COMPREPLY=($(compgen -W "$sp" -- "$cur"))
      fi
      ;;
    add)
      if (( cword == 3 )); then
        COMPREPLY=($(compgen -d -- "$cur"))
      fi
      ;;
  esac
}

complete -F _summon summon
`;
}
