import { inject } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    /** Entry of the private unsplit CLI bundle (./cli-builds.setup.ts). */
    summonCliUnsplit: string;
    /** Entry of the private build made with the shipped tsup.config.ts. */
    summonCliProduction: string;
    /** SUMMON_PROBE_DIST=1 only: entry of the run's copy of dist/, else null. */
    summonCliDistSnapshot: string | null;
  }
}

export type CliFlavor = "unsplit" | "production";

/**
 * The bundled CLI entry that the globalSetup built for this run. Subprocess suites spawn this,
 * never the shared dist/.
 */
export function cliBuild(flavor: CliFlavor): string {
  const path = inject(flavor === "unsplit" ? "summonCliUnsplit" : "summonCliProduction");
  if (!path) throw new Error("cliBuild: no CLI build provided; run through vitest.config.ts (globalSetup src/fixtures/cli-builds.setup.ts)");
  return path;
}
