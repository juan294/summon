import { VALID_KEYS, CLI_FLAGS, BOOLEAN_KEYS, listCustomLayouts } from "./config.js";
import { getPresetNames } from "./layout.js";

export function generateZshCompletion(): string {
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
    'status:Show workspace status across all projects'
    'switch:Switch to an active project'
    'snapshot:Manage context snapshots'
    'briefing:Morning briefing across all projects'
    'ports:Show port assignments across projects'
    'export:Export config as .summon file'
    'freeze:Save current config as a reusable layout'
    'keybindings:Generate Ghostty key table for navigation'
    'layout:Manage custom layouts'
    'session:Launch a saved multi-project session'
    'trust:Trust the .summon file in a directory'
  )

  local -a config_keys=(${configKeys})
  local -a layout_presets=(\${(f)"$(summon layout list --names 2>/dev/null)"})
  local projects_file="\${HOME}/.config/summon/projects"
  local sessions_dir="\${HOME}/.config/summon/sessions"
  local -a session_names=()
  if [[ -d "$sessions_dir" ]]; then
    session_names=(\${(f)"$(ls "$sessions_dir" 2>/dev/null)"})
  fi

  # Read project names dynamically
  local -a project_names=()
  if [[ -f "$projects_file" ]]; then
    project_names=(\${(f)"$(cut -d= -f1 "$projects_file")"})
  fi

  _arguments -C \\
    '(-h --help)'{-h,--help}'[Show help]' \\
    '(-v --version)'{-v,--version}'[Show version]' \\
    '(-l --layout)'{-l,--layout}'[Layout preset]:preset:->layout_preset' \\
    '(-e --editor)'{-e,--editor}'[Editor command]:command:' \\
    '(-p --panes)'{-p,--panes}'[Editor panes]:count:' \\
    '--editor-size[Editor width %]:percent:' \\
    '(-s --sidebar)'{-s,--sidebar}'[Sidebar command]:command:' \\
    '--shell[Shell pane]:value:(true false)' \\
    '--auto-resize[Enable auto-resize]' \\
    '--no-auto-resize[Disable auto-resize]' \\
    '--clean[Auto-close stale panes from prior session]' \\
    '--no-clean[Skip auto-close of restored panes]' \\
    '--starship-preset[Starship preset]:preset:->starship_preset' \\
    '*--env[Set environment variable]:var:' \\
    '--font-size[Font size in points]:size:' \\
    '--on-start[Run command before workspace creation]:command:' \\
    '--new-window[Open in new Ghostty window]' \\
    '--new-tab[Open in a new Ghostty tab]' \\
    '--no-project-config[Skip loading project-level config file]' \\
    '--verbose[Show verbose output (e.g. resolved config paths)]' \\
    '--fullscreen[Start in fullscreen mode]' \\
    '--maximize[Start maximized]' \\
    '--float[Float window on top]' \\
    '(-n --dry-run)'{-n,--dry-run}'[Dry run]' \\
    '1: :->cmd' \\
    '*::arg:->args'

  case "$state" in
    layout_preset)
      compadd -a layout_presets
      return
      ;;
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
            compadd zsh bash fish
          fi
          ;;
        doctor)
          if (( CURRENT == 2 )); then
            compadd -- --fix
          fi
          ;;
        status)
          if (( CURRENT == 2 )); then
            compadd -- --once
          fi
          ;;
        snapshot)
          if (( CURRENT == 2 )); then
            compadd save show clear
          fi
          ;;
        keybindings)
          if (( CURRENT == 2 )); then
            compadd -- --vim
          fi
          ;;
        freeze)
          compadd -a layout_presets
          ;;
        export)
          _files
          ;;
        trust)
          _directories
          ;;
        layout)
          if (( CURRENT == 2 )); then
            compadd create save list show delete edit
          elif (( CURRENT == 3 )); then
            case "\${words[2]}" in
              show|delete|edit)
                compadd -a layout_presets
                ;;
            esac
          fi
          ;;
        session)
          if (( CURRENT == 2 )); then
            compadd -- --all add remove list show
            compadd -a session_names
          elif (( CURRENT == 3 )); then
            case "\${words[2]}" in
              show|remove)
                compadd -a session_names
                ;;
            esac
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
  const flagsList = CLI_FLAGS.join(" ");
  const booleanKeyCheck = [...BOOLEAN_KEYS].map(k => `"\\$\{words[2]}" == "${k}"`).join(" || ");

  return `_summon() {
  local cur prev words cword
  if type _init_completion &>/dev/null; then
    _init_completion || return
  else
    COMPREPLY=()
    local cur="\${COMP_WORDS[COMP_CWORD]}"
    local prev="\${COMP_WORDS[COMP_CWORD-1]}"
  fi

  local subcommands="add remove list set config setup completions doctor open status switch snapshot briefing ports export freeze keybindings layout session trust"
  local config_keys="${configKeys}"
  local layout_presets
  layout_presets=$(summon layout list --names 2>/dev/null)
  local projects_file="\${HOME}/.config/summon/projects"
  local sessions_dir="\${HOME}/.config/summon/sessions"
  local session_names=""
  if [[ -d "$sessions_dir" ]]; then
    session_names=$(ls "$sessions_dir" 2>/dev/null)
  fi

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
      COMPREPLY=($(compgen -W "zsh bash fish" -- "$cur"))
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
    status)
      COMPREPLY=($(compgen -W "--once" -- "$cur"))
      ;;
    snapshot)
      COMPREPLY=($(compgen -W "save show clear" -- "$cur"))
      ;;
    doctor)
      COMPREPLY=($(compgen -W "--fix" -- "$cur"))
      ;;
    keybindings)
      COMPREPLY=($(compgen -W "--vim" -- "$cur"))
      ;;
    freeze)
      COMPREPLY=($(compgen -W "$layout_presets" -- "$cur"))
      ;;
    export)
      COMPREPLY=($(compgen -f -- "$cur"))
      ;;
    layout)
      if (( cword == 2 )); then
        COMPREPLY=($(compgen -W "create save list show delete edit" -- "$cur"))
      elif (( cword == 3 )); then
        case "\${words[2]}" in
          show|delete|edit)
            COMPREPLY=($(compgen -W "$layout_presets" -- "$cur"))
            ;;
        esac
      fi
      ;;
    session)
      if (( cword == 2 )); then
        COMPREPLY=($(compgen -W "--all add remove list show $session_names" -- "$cur"))
      elif (( cword == 3 )); then
        case "\${words[2]}" in
          show|remove)
            COMPREPLY=($(compgen -W "$session_names" -- "$cur"))
            ;;
        esac
      fi
      ;;
  esac
}

complete -F _summon summon
`;
}

export function generateFishCompletion(): string {
  const customLayouts = listCustomLayouts();
  const allLayouts = [...getPresetNames(), ...customLayouts];
  const configKeys = VALID_KEYS.join(" ");

  const subcommands: Array<[string, string]> = [
    ["add", "Register a project"],
    ["remove", "Remove a project"],
    ["list", "List registered projects"],
    ["set", "Set a config value"],
    ["config", "Show current config"],
    ["setup", "Interactive setup wizard"],
    ["completions", "Generate shell completions"],
    ["doctor", "Check Ghostty config"],
    ["open", "Select and launch a project"],
    ["status", "Show workspace status across all projects"],
    ["switch", "Switch to an active project"],
    ["snapshot", "Manage context snapshots"],
    ["briefing", "Morning briefing across all projects"],
    ["ports", "Show port assignments across projects"],
    ["export", "Export config as .summon file"],
    ["freeze", "Save current config as a reusable layout"],
    ["keybindings", "Generate Ghostty key table for navigation"],
    ["layout", "Manage custom layouts"],
    ["session", "Launch a saved multi-project session"],
    ["trust", "Trust the .summon file in a directory"],
  ];

  const subcommandLines = subcommands
    .map(([name, desc]) => `complete -c summon -n '__fish_use_subcommand' -a '${name}' -d '${desc}'`)
    .join("\n");

  const layoutPresets = allLayouts.join(" ");

  return `# summon fish completion
# Setup: eval (summon completions fish | psub)
complete -c summon -f
${subcommandLines}
complete -c summon -l help -s h -d 'Show help'
complete -c summon -l version -s v -d 'Show version'
complete -c summon -l layout -s l -d 'Layout preset or tree DSL' -a '${layoutPresets}'
complete -c summon -l editor -s e -d 'Editor command'
complete -c summon -l panes -s p -d 'Number of editor panes'
complete -c summon -l editor-size -d 'Editor width %'
complete -c summon -l sidebar -s s -d 'Sidebar command'
complete -c summon -l shell -d 'Shell pane (true, false, or command)'
complete -c summon -l auto-resize -d 'Enable auto-resize'
complete -c summon -l no-auto-resize -d 'Disable auto-resize'
complete -c summon -l clean -d 'Auto-close stale panes from prior session'
complete -c summon -l no-clean -d 'Skip auto-close of restored panes'
complete -c summon -l starship-preset -d 'Starship prompt preset name'
complete -c summon -l env -d 'Set environment variable (KEY=VALUE)'
complete -c summon -l font-size -d 'Font size in points'
complete -c summon -l on-start -d 'Run command before workspace creation'
complete -c summon -l new-window -d 'Open in new Ghostty window'
complete -c summon -l new-tab -d 'Open in a new Ghostty tab'
complete -c summon -l no-project-config -d 'Skip loading project-level config file'
complete -c summon -l fullscreen -d 'Start in fullscreen mode'
complete -c summon -l maximize -d 'Start maximized'
complete -c summon -l float -d 'Float window on top'
complete -c summon -l dry-run -s n -d 'Print AppleScript without executing'
complete -c summon -l verbose -d 'Show verbose output (e.g. resolved config paths)'
complete -c summon -n '__fish_seen_subcommand_from status' -l once -d 'Print status table once and exit'
complete -c summon -n '__fish_seen_subcommand_from set' -n '__fish_is_nth_token 2' -a '${configKeys}' -d 'Config key'
complete -c summon -n '__fish_seen_subcommand_from session' -n 'not __fish_seen_subcommand_from add remove list show' -a 'add remove list show' -d 'Session action'
complete -c summon -n '__fish_seen_subcommand_from session' -l all -d 'Launch every registered project'
`;
}
