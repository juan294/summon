import { VALID_KEYS, CLI_FLAGS, BOOLEAN_KEYS, listCustomLayouts } from "./config.js";
import { getPresetNames } from "./layout.js";

// ---------------------------------------------------------------------------
// Declarative source-of-truth for subcommands and flags (#444 FE-S2)
// ---------------------------------------------------------------------------

/** Single subcommand descriptor used by all three shell generators. */
interface SubcommandSpec {
  name: string;
  desc: string;
}

/** Argument style for a flag that takes a value. */
type FlagArgKind =
  | "preset"        // layout preset (dynamic from summon layout list)
  | "starship"      // starship preset (dynamic from starship CLI)
  | "shell-toggle"  // "true" or "false"
  | "value"         // arbitrary value (no completion)
  | "number"        // numeric value
  | "command";      // command string

/** Single flag descriptor used by all three shell generators. */
interface FlagSpec {
  long: string;               // e.g. "layout" (without --)
  short?: string;             // e.g. "l" (without -)
  desc: string;
  arg?: FlagArgKind;          // if present, flag takes an argument
  repeatable?: boolean;       // e.g. --env can be specified multiple times
}

/**
 * Canonical subcommand list.
 * Changing this table automatically updates bash, zsh, and fish.
 */
const SUBCOMMAND_SPECS: SubcommandSpec[] = [
  { name: "add",          desc: "Register a project" },
  { name: "remove",       desc: "Remove a project" },
  { name: "list",         desc: "List registered projects" },
  { name: "set",          desc: "Set a config value" },
  { name: "config",       desc: "Show current config" },
  { name: "setup",        desc: "Interactive setup wizard" },
  { name: "completions",  desc: "Generate shell completions" },
  { name: "doctor",       desc: "Check Ghostty config" },
  { name: "open",         desc: "Select and launch a project" },
  { name: "status",       desc: "Show workspace status across all projects" },
  { name: "switch",       desc: "Switch to an active project" },
  { name: "snapshot",     desc: "Manage context snapshots" },
  { name: "briefing",     desc: "Morning briefing across all projects" },
  { name: "ports",        desc: "Show port assignments across projects" },
  { name: "export",       desc: "Export config as .summon file" },
  { name: "freeze",       desc: "Save current config as a reusable layout" },
  { name: "keybindings",  desc: "Generate Ghostty key table for navigation" },
  { name: "layout",       desc: "Manage custom layouts" },
  { name: "session",      desc: "Launch a saved multi-project session" },
  { name: "trust",        desc: "Trust the .summon file in a directory" },
];

/**
 * Canonical flag list.
 * Long names must match the entries in CLI_FLAGS (from config.ts).
 * All three shell generators derive their flag completions from this table.
 */
const FLAG_SPECS: FlagSpec[] = [
  { long: "help",              short: "h", desc: "Show help" },
  { long: "version",           short: "v", desc: "Show version" },
  { long: "layout",            short: "l", desc: "Layout preset or tree DSL", arg: "preset" },
  { long: "editor",            short: "e", desc: "Editor command",            arg: "command" },
  { long: "panes",             short: "p", desc: "Number of editor panes",    arg: "number" },
  { long: "editor-size",                   desc: "Editor width %",            arg: "number" },
  { long: "sidebar",           short: "s", desc: "Sidebar command",           arg: "command" },
  { long: "shell",                         desc: "Shell pane (true, false, or command)", arg: "shell-toggle" },
  { long: "auto-resize",                   desc: "Enable auto-resize" },
  { long: "no-auto-resize",                desc: "Disable auto-resize" },
  { long: "clean",                         desc: "Auto-close stale panes from prior session" },
  { long: "no-clean",                      desc: "Skip auto-close of restored panes" },
  { long: "starship-preset",               desc: "Starship prompt preset name", arg: "starship" },
  { long: "env",                           desc: "Set environment variable (KEY=VALUE)", arg: "value", repeatable: true },
  { long: "font-size",                     desc: "Font size in points",        arg: "number" },
  { long: "on-start",                      desc: "Run command before workspace creation", arg: "command" },
  { long: "new-window",                    desc: "Open in new Ghostty window" },
  { long: "new-tab",                       desc: "Open in a new Ghostty tab" },
  { long: "no-project-config",             desc: "Skip loading project-level config file" },
  { long: "fullscreen",                    desc: "Start in fullscreen mode" },
  { long: "maximize",                      desc: "Start maximized" },
  { long: "float",                         desc: "Float window on top" },
  { long: "dry-run",           short: "n", desc: "Print AppleScript without executing" },
  { long: "verbose",                       desc: "Show verbose output (e.g. resolved config paths)" },
  // --once is a subcommand flag (status), included in CLI_FLAGS for bash completion
  { long: "once",                          desc: "Print status table once and exit" },
];

// Verify at module load that FLAG_SPECS covers all CLI_FLAGS entries.
// This is a development-time consistency guard — if CLI_FLAGS gains a new entry,
// FLAG_SPECS must be updated too (and vice versa).
/* istanbul ignore next */
if (process.env["NODE_ENV"] !== "test") {
  const specLongs = new Set(FLAG_SPECS.map(f => `--${f.long}`));
  const specShorts = new Set(FLAG_SPECS.filter(f => f.short).map(f => `-${f.short}`));
  for (const flag of CLI_FLAGS) {
    if (!specLongs.has(flag) && !specShorts.has(flag)) {
      process.stderr.write(
        `summon completions: FLAG_SPECS is missing entry for CLI_FLAGS "${flag}" — update FLAG_SPECS in completions.ts\n`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Shell-specific generators
// ---------------------------------------------------------------------------

export function generateZshCompletion(): string {
  const configKeys = VALID_KEYS.join(" ");
  const booleanKeyCheck = [...BOOLEAN_KEYS].map(k => `"\\$\{words[2]}" == "${k}"`).join(" || ");

  // Build subcommand list from SUBCOMMAND_SPECS
  const subcommandLines = SUBCOMMAND_SPECS
    .map(s => `    '${s.name}:${s.desc}'`)
    .join("\n");

  // Build _arguments flag entries from FLAG_SPECS.
  // Flags with a short form use zsh brace-alternation: '(-s --long)'{-s,--long}'[desc]'
  const argLines = FLAG_SPECS.map(f => {
    const long = `--${f.long}`;

    if (f.arg === "preset") {
      if (f.short) {
        return `    '(-${f.short} ${long})'{-${f.short},${long}}'[${f.desc}]:preset:->layout_preset' \\`;
      }
      return `    '${long}[${f.desc}]:preset:->layout_preset' \\`;
    }
    if (f.arg === "starship") {
      return `    '${long}[${f.desc}]:preset:->starship_preset' \\`;
    }
    if (f.arg === "shell-toggle") {
      return `    '${long}[${f.desc}]:value:(true false)' \\`;
    }
    if (f.arg === "value") {
      const rep = f.repeatable ? "*" : "";
      return `    '${rep}${long}[${f.desc}]:var:' \\`;
    }
    if (f.arg === "command" || f.arg === "number") {
      const argLabel = f.arg === "number" ? "count" : "command";
      if (f.short) {
        return `    '(-${f.short} ${long})'{-${f.short},${long}}'[${f.desc}]:${argLabel}:' \\`;
      }
      return `    '${long}[${f.desc}]:${argLabel}:' \\`;
    }

    // Boolean flags (no argument)
    if (f.short) {
      return `    '(-${f.short} ${long})'{-${f.short},${long}}'[${f.desc}]' \\`;
    }
    return `    '${long}[${f.desc}]' \\`;
  }).join("\n");

  return `#compdef summon

_summon() {
  local -a subcommands=(
${subcommandLines}
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
${argLines}
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

  // Build subcommand string from SUBCOMMAND_SPECS
  const subcommandList = SUBCOMMAND_SPECS.map(s => s.name).join(" ");

  return `_summon() {
  local cur prev words cword
  if type _init_completion &>/dev/null; then
    _init_completion || return
  else
    COMPREPLY=()
    local cur="\${COMP_WORDS[COMP_CWORD]}"
    local prev="\${COMP_WORDS[COMP_CWORD-1]}"
  fi

  local subcommands="${subcommandList}"
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

  // Build subcommand completion lines from SUBCOMMAND_SPECS
  const subcommandLines = SUBCOMMAND_SPECS
    .map(s => `complete -c summon -n '__fish_use_subcommand' -a '${s.name}' -d '${s.desc}'`)
    .join("\n");

  // Build flag completion lines from FLAG_SPECS
  // --once is a status-specific flag — rendered with subcommand guard, not as a global flag.
  // --layout is rendered separately with preset values appended, so skip it here.
  const globalFlagLines = FLAG_SPECS
    .filter(f => f.long !== "once" && f.long !== "layout")
    .map(f => {
      const short = f.short ? ` -s ${f.short}` : "";
      return `complete -c summon -l ${f.long}${short} -d '${f.desc}'`;
    })
    .join("\n");

  const layoutPresets = allLayouts.join(" ");

  return `# summon fish completion
# Setup: eval (summon completions fish | psub)
complete -c summon -f
${subcommandLines}
${globalFlagLines}
complete -c summon -l layout -s l -d 'Layout preset or tree DSL' -a '${layoutPresets}'
complete -c summon -n '__fish_seen_subcommand_from status' -l once -d 'Print status table once and exit'
complete -c summon -n '__fish_seen_subcommand_from set' -n '__fish_is_nth_token 2' -a '${configKeys}' -d 'Config key'
complete -c summon -n '__fish_seen_subcommand_from session' -n 'not __fish_seen_subcommand_from add remove list show' -a 'add remove list show' -d 'Session action'
complete -c summon -n '__fish_seen_subcommand_from session' -l all -d 'Launch every registered project'
`;
}
