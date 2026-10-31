/**
 * How this process was started (node binary and script), recorded by the CLI entry so shell
 * text typed into a workspace can run the same Summon later (the cleanup trap's snapshot save).
 * Without a registration (library use, tests) callers fall back to `summon` on PATH.
 */
let invocation: { execPath: string; script: string } | undefined;

export function registerSelfInvocation(execPath: string, script: string | undefined): void {
  invocation = script ? { execPath, script } : undefined;
}

export function selfInvocation(): { execPath: string; script: string } | undefined {
  return invocation;
}

export function clearSelfInvocation(): void {
  invocation = undefined;
}
