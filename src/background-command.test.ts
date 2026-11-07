import { describe, it, expect } from "vitest";
import { isBackgroundCommand } from "./background-command.js";

/**
 * The table is the oracle (plan Phase 3, D3): a pane whose command is one of these opens minimized under Rex when no
 * `pane.<name>.background` key says otherwise. Every command of the owner's layouts except `npm run dev` must stay visible.
 */
describe("isBackgroundCommand: commands that only run in the background", () => {
  it.each([
    // package scripts
    "npm run dev", "npm start", "npm run start", "pnpm dev", "pnpm run dev:web", "pnpm start", "pnpm serve", "pnpm watch:css",
    "yarn start", "yarn dev", "yarn run preview", "bun run watch", "npm run server", "pnpm preview --host",
    // an environment prefix and an absolute path do not change the program
    "PORT=3001 npm run dev", "NODE_ENV=development PORT=3000 pnpm dev", "/opt/homebrew/bin/nodemon server.js",
    // log followers
    "tail -f log/development.log", "tail -n 100 -F app.log", "tail --follow=name app.log", "journalctl -fu nginx", "journalctl --follow",
    "docker logs -f api", "docker compose logs -f api", "docker-compose logs --follow", "kubectl logs --follow deploy/api", "kubectl logs -f pod/x",
    // servers and watchers
    "vite", "vite dev", "vite --host", "vite preview --port 4173", "next dev -p 4000", "next start", "nuxt dev", "astro dev", "astro preview",
    "nodemon", "nodemon src/index.js", "tsx watch src/index.ts", "tsc --watch", "tsc -w -p tsconfig.json", "wrangler dev",
    "docker compose up", "docker-compose up", "docker compose up api db", "python3 -m http.server 8000", "python -m http.server",
    "uvicorn app.main:app --reload", "flask run", "rails server", "rails s", "hugo server", "hugo serve", "cargo watch -x test",
    "stripe listen --forward-to localhost:3000", "ngrok http 3000", "ngrok start --all", "ngrok tcp 22",
    "nodemon -w src app.js", "journalctl -fu nginx", "tail -fn 20 app.log", "tail -v -f app.log", "rails s -p 3001",
  ])("%s", (command) => {
    expect(isBackgroundCommand(command)).toBe(true);
  });
});

describe("isBackgroundCommand: commands that stay visible", () => {
  it.each([
    // the owner's layouts (every pane command but `npm run dev`)
    "lazygit", "btop", "nvim", "yazi", "claude --model opus", "claude --model sonnet", "claude",
    "codex --ask-for-approval never --sandbox danger-full-access", "zsh", "python3", "node", "hx", "vim", "nano", "code", "gh-glance",
    "sudo bandwhich", "lnav", "gping google.com cloudflare.com", "lazydocker", "visidata", "posting", "cmatrix", "btm", "fastfetch", "cbonsai -l",
    // programs that finish or that you work in
    "npm test", "npm run build", "npm run lint", "npm run", "npm", "pnpm install", "pnpm test", "pnpm build", "yarn", "vitest", "vite build",
    "tail app.log", "tail -n 100 app.log", "journalctl -u nginx", "docker logs api", "docker compose logs api", "docker compose up -d", "docker compose up --detach", "docker compose ps",
    "next build", "tsc", "tsc --noEmit", "python3 script.py", "python3 -m pytest", "cargo build", "flask routes", "rails console",
    // help, version and one-off subcommands print and exit (second review of Phase 3)
    "vite --help", "vite -v", "vite --version", "ngrok version", "ngrok config add-authtoken abc", "ngrok", "nodemon --version", "nodemon -v", "uvicorn --help", "next dev --help",
    // a program that detaches or exits after starting its services
    "rails s -d", "rails server --daemon", "docker compose up --wait", "docker compose up --no-start", "docker compose up -dV", "docker-compose up -d",
    // `-F` of journalctl is --field (lists values and exits), not follow
    "journalctl -F SYSLOG_IDENTIFIER",
    // a pipeline, a chain or a substitution is never guessed
    "npm run dev | tee dev.log", "cd api && npm run dev", "npm run dev; echo done", "tail -f x.log > out.txt", "echo $(npm run dev)",
    // nothing to read
    "", "   ", "PORT=3000",
  ])("%s", (command) => {
    expect(isBackgroundCommand(command)).toBe(false);
  });
});
