import { commandHasShellMeta } from "./command-spec.js";

/**
 * Commands that only run in the background (a dev server, a watcher, a log follower), so a Rex workspace opens their
 * pane minimized (plan 2026-11-05, D3). A small table, not a guess: a command that is not listed stays visible, and
 * `pane.<name>.background=true|false` overrides the answer either way. A pipeline, a chain or a substitution is never
 * guessed; neither is a command that only sets variables. Pure.
 */

/** `npm run dev`, `pnpm start`, `yarn serve:web`, `bun run watch`: the script names that mean "keep running". */
const SERVE_SCRIPT_RE = /^(dev|start|serve|server|watch|preview)([:-].+)?$/;
const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const PYTHON_RE = /^python(\d+(\.\d+)?)?$/;
/** A short option cluster that carries the follow flag: `-f`, `-fu`, `-nf`. `tail` also follows with `-F` (`journalctl -F` is `--field`). */
const SHORT_FOLLOW_RE = /^-[A-Za-z0-9]*f[A-Za-z0-9]*$/;
const SHORT_FOLLOW_OR_RETRY_RE = /^-[A-Za-z0-9]*[fF][A-Za-z0-9]*$/;
/** A short option cluster that carries `-d`: `-d`, `-dV`. */
const SHORT_DETACH_RE = /^-[A-Za-z]*d[A-Za-z]*$/;
/** Options that make a program print and exit instead of running. */
const INFO_FLAGS: ReadonlySet<string> = new Set(["-h", "--help", "--version"]);
const VERSION_FLAGS: ReadonlySet<string> = new Set(["-v", "-V"]);

const follows = (args: readonly string[], retry = false): boolean => args.some((arg) => arg === "--follow" || arg.startsWith("--follow=") || (retry ? SHORT_FOLLOW_OR_RETRY_RE : SHORT_FOLLOW_RE).test(arg));
/** `docker compose up` that returns once its services are up (detached, waited for, or only created). */
const detaches = (args: readonly string[]): boolean => args.some((arg) => arg === "--detach" || arg === "--wait" || arg === "--no-start" || SHORT_DETACH_RE.test(arg));
const prints = (args: readonly string[]): boolean => args.some((arg) => INFO_FLAGS.has(arg));
const printsVersion = (args: readonly string[]): boolean => args.some((arg) => VERSION_FLAGS.has(arg));
/** The first argument that is not an option (`vite --host` has none, `vite build` has `build`). */
const subcommand = (args: readonly string[]): string | undefined => args.find((arg) => !arg.startsWith("-"));

function isPackageScript(program: string, args: readonly string[]): boolean {
  const [first, second] = args;
  if (program === "npm") return first === "start" || (first === "run" && SERVE_SCRIPT_RE.test(second ?? ""));
  if (program === "pnpm" || program === "yarn") return first !== undefined && SERVE_SCRIPT_RE.test(first === "run" ? second ?? "" : first);
  if (program === "bun") return first === "run" && SERVE_SCRIPT_RE.test(second ?? "");
  return false;
}

function isFollower(program: string, args: readonly string[]): boolean {
  switch (program) {
    case "tail":
      return follows(args, true);
    case "journalctl":
      return follows(args);
    case "docker":
      return follows(args) && (args[0] === "logs" || (args[0] === "compose" && args[1] === "logs"));
    case "docker-compose":
    case "kubectl":
      return follows(args) && args[0] === "logs";
    default:
      return false;
  }
}

function isServerOrWatcher(program: string, args: readonly string[]): boolean {
  const sub = subcommand(args);
  switch (program) {
    case "vite": return !printsVersion(args) && (sub === undefined || sub === "dev" || sub === "serve" || sub === "preview");
    case "next": return sub === "dev" || sub === "start";
    case "nuxt":
    case "wrangler": return sub === "dev";
    case "astro": return sub === "dev" || sub === "preview";
    case "nodemon": return !printsVersion(args);
    case "uvicorn": return true;
    case "ngrok": return sub === "http" || sub === "tcp" || sub === "tls" || sub === "start";
    case "tsx": return sub === "watch";
    case "tsc": return args.includes("-w") || args.includes("--watch");
    case "docker": return args[0] === "compose" && args[1] === "up" && !detaches(args);
    case "docker-compose": return args[0] === "up" && !detaches(args);
    case "flask": return sub === "run";
    case "rails": return (sub === "server" || sub === "s") && !args.includes("-d") && !args.includes("--daemon");
    case "hugo": return sub === "server" || sub === "serve";
    case "cargo": return sub === "watch";
    case "stripe": return sub === "listen";
    // `python -m http.server` (python, python3, python3.12)
    default: return PYTHON_RE.test(program) && args[0] === "-m" && args[1] === "http.server";
  }
}

export function isBackgroundCommand(raw: string): boolean {
  const text = raw.trim();
  if (text === "" || commandHasShellMeta(text)) return false;
  const words = text.split(/\s+/);
  while (words[0] !== undefined && ENV_ASSIGNMENT_RE.test(words[0])) words.shift();
  const [executable, ...args] = words;
  if (executable === undefined) return false;
  const program = executable.split("/").pop() ?? executable;
  // A program asked for its help or version prints and exits, whatever it is.
  if (prints(args)) return false;
  return isPackageScript(program, args) || isFollower(program, args) || isServerOrWatcher(program, args);
}
