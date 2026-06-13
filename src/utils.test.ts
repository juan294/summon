import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock child_process before importing utils.
// AR-M1 #603: include execFile (with promisify.custom so that promisify(execFile)
// returns an async function that yields {stdout, stderr}) so gitOutput's dynamic
// import works in this test file.
import { promisify as _utilPromisify } from "node:util";
const mockExecFileSync = vi.fn();

// Async implementation that powers the execFile mock (via promisify.custom).
// Returns {stdout, stderr} to match the real execFile promisified signature.
type ExecFileCbResult = { stdout: string; stderr: string };
let _mockExecFileAsyncImpl: (...args: unknown[]) => Promise<ExecFileCbResult> = async () => ({ stdout: "", stderr: "" });
const mockExecFile = vi.fn();
(mockExecFile as unknown as Record<symbol, unknown>)[_utilPromisify.custom] =
  async (...args: unknown[]): Promise<ExecFileCbResult> => _mockExecFileAsyncImpl(...args);

// Helpers to control the async execFile mock behavior in tests
const mockExecFileAsync = {
  mockResolveOnce(stdout: string) {
    const origImpl = _mockExecFileAsyncImpl;
    let used = false;
    _mockExecFileAsyncImpl = async (...args: unknown[]) => {
      if (!used) { used = true; _mockExecFileAsyncImpl = origImpl; return { stdout, stderr: "" }; }
      return origImpl(...args);
    };
  },
  mockReject(err: Error) {
    _mockExecFileAsyncImpl = async () => { throw err; };
  },
  reset() {
    _mockExecFileAsyncImpl = async () => ({ stdout: "", stderr: "" });
  },
};

vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  return {
    ...real,
    execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
    execFile: mockExecFile,
  };
});

// Mock node:fs for isGhosttyInstalled tests.
// writeFileSync and renameSync are passed through to the real implementations
// so that atomicWrite (which uses them) works correctly in tests.
const mockExistsSync = vi.fn((_path: string) => false);
const mockMkdirSync = vi.fn();
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    existsSync: (path: string) => mockExistsSync(path),
    mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  };
});

// Mock readline for promptUser tests
const mockQuestion = vi.fn();
const mockClose = vi.fn();
const mockOn = vi.fn();
const mockOff = vi.fn();
vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (_q: string, cb: (a: string) => void) => mockQuestion(_q, cb),
    close: mockClose,
    on: (event: string, cb: () => void) => mockOn(event, cb),
    off: (event: string, cb: () => void) => mockOff(event, cb),
  }),
}));

// Import after mocks
const { SAFE_COMMAND_RE, GHOSTTY_PATHS, GHOSTTY_APP_NAME, SUMMON_WORKSPACE_ENV, resolveCommand, promptUser, getErrorMessage, exitWithUsageHint, formatUserError, checkAccessibility, openAccessibilitySettings, isAccessibilityError, isGhosttyInstalled, ACCESSIBILITY_SETTINGS_PATH, ACCESSIBILITY_ENABLE_HINT, ACCESSIBILITY_REQUIRED_MSG, PromptCancelled, isDebug, debugLog, supportsColor, confirm, gitSafeEnv, resetGitSafeEnvCache, atomicWrite, resetGitOutputCache } = await import("./utils.js");
