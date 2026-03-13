import { getPresetNames } from "./layout.js";
import { VALID_KEYS, CLI_FLAGS } from "./config.js";

export function generateZshCompletion(): string {
  const presetNames = getPresetNames().join(" ");
  const configKeys = VALID_KEYS.join(" ");

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
    '--server[Server pane]:value:(true false)' \\
    '--auto-resize[Enable auto-resize]' \\
    '--no-auto-resize[Disable auto-resize]' \\
    '(-n --dry-run)'{-n,--dry-run}'[Dry run]' \\
    '1: :->cmd' \\
    '*::arg:->args'

  case "$state" in
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
          elif [[ "\${words[2]}" == "auto-resize" ]]; then
            compadd true false
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

  return `_summon() {
  local cur prev words cword
  _init_completion || return

  local subcommands="add remove list set config setup completions"
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
    --server)
      COMPREPLY=($(compgen -W "true false" -- "$cur"))
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
      elif [[ "\${words[2]}" == "auto-resize" ]]; then
        COMPREPLY=($(compgen -W "true false" -- "$cur"))
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
