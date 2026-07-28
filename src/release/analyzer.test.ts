import { describe, it, expect } from "vitest";

// The analyzer is deliberately plain ESM outside src/ so it never lands in the
// published tarball (package.json `files` ships everything tsup emits).
// @ts-expect-error -- untyped .mjs module, exercised entirely through these tests
import { analyze, formatBlocks } from "../../scripts/release/analyzer.mjs";

const NOW = "2026-07-28T12:00:00Z";
const CANDIDATE = "53ad23e48877944dff2b44e3262f1ccb66457eb9";
const OTHER = "12d59df0000000000000000000000000000000aa";

type Result = Record<string, unknown>;

function probe(over: Result = {}): Result {
  return {
    probeId: "release.cli-contract",
    required: true,
    status: "passed",
    owner: "maintainer",
    startedAt: NOW,
    finishedAt: NOW,
    runner: "vitest",
    oracles: { exitCode: 0 },
    fixtures: [{ id: "summon-rel-test-0", cleanupStatus: "removed" }],
    ...over,
  };
}

function manifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    release: {
      baseline: "v1.8.0",
      candidate: CANDIDATE,
      deployedIdentity: null,
      environment: "ci-ubuntu",
      generatedAt: NOW,
    },
    results: [probe(), probe({ probeId: "release.dry-run-golden" })],
    cadence: [],
    exceptions: [],
    ...over,
  };
}

const run = (m: unknown, expected = CANDIDATE) =>
  analyze(m, { now: NOW, expectedCandidate: expected });

const codes = (m: unknown, expected = CANDIDATE): string[] =>
  run(m, expected).blocks.map((b: { code: string }) => b.code);

describe("release analyzer", () => {
  // Case 1
  it("passes a complete evidence set", () => {
    const result = run(manifest());
    expect(result.blocks).toEqual([]);
    expect(result.ok).toBe(true);
  });

  // Case 2 — the regression for the bug that is live today: a required CI check
  // that skips its only test and still reports green.
  it("FAILS when zero checks passed and everything skipped", () => {
    const m = manifest({
      results: [
        probe({ status: "skipped" }),
        probe({ probeId: "release.dry-run-golden", status: "skipped" }),
      ],
    });
    expect(codes(m)).toContain("ZERO_PASS");
    expect(run(m).ok).toBe(false);
  });

  // Case 3
  it("blocks when a required probe skipped", () => {
    const m = manifest({
      results: [probe(), probe({ probeId: "release.trust-enforcement", status: "skipped" })],
    });
    const result = run(m);
    expect(result.blocks.map((b: { code: string }) => b.code)).toContain("REQUIRED_MISS");
    expect(result.blocks.find((b: { code: string }) => b.code === "REQUIRED_MISS")?.detail).toContain(
      "release.trust-enforcement",
    );
  });

  // Case 4 — quarantine does not excuse a required miss (D04)
  it("blocks a required failure even when an exception quarantines it", () => {
    const m = manifest({
      results: [probe(), probe({ probeId: "release.trust-enforcement", status: "failed" })],
      exceptions: [
        {
          id: "EX-1",
          probeId: "release.trust-enforcement",
          reason: "flaky",
          risk: "low",
          approvedBy: "maintainer",
          createdAt: NOW,
          expiresAt: "2026-12-31T00:00:00Z",
        },
      ],
    });
    const got = codes(m);
    expect(got).toContain("REQUIRED_MISS");
    expect(got).toContain("EXCEPTION_ON_REQUIRED");
  });

  // Case 5
  it("allows an optional failure with a valid unexpired exception", () => {
    const m = manifest({
      results: [
        probe(),
        probe({ probeId: "release.optional-thing", required: false, status: "failed" }),
      ],
      exceptions: [
        {
          id: "EX-2",
          probeId: "release.optional-thing",
          reason: "known upstream issue",
          risk: "low",
          approvedBy: "maintainer",
          createdAt: NOW,
          expiresAt: "2026-12-31T00:00:00Z",
        },
      ],
    });
    expect(run(m).ok).toBe(true);
  });

  // Case 6
  it("blocks when an exception has expired", () => {
    const m = manifest({
      results: [
        probe(),
        probe({ probeId: "release.optional-thing", required: false, status: "failed" }),
      ],
      exceptions: [
        {
          id: "EX-3",
          probeId: "release.optional-thing",
          reason: "stale",
          risk: "low",
          approvedBy: "maintainer",
          createdAt: "2026-01-01T00:00:00Z",
          expiresAt: "2026-07-01T00:00:00Z",
        },
      ],
    });
    expect(codes(m)).toContain("EXPIRED_EXCEPTION");
  });

  // Case 7
  it("blocks when the manifest names a different candidate", () => {
    expect(codes(manifest(), OTHER)).toContain("CANDIDATE_MISMATCH");
  });

  // Case 8 — the regression for v1.8.0 being tagged against two trees
  it("blocks when the deployed identity differs from the candidate", () => {
    const m = manifest({
      release: {
        baseline: "v1.8.0",
        candidate: CANDIDATE,
        deployedIdentity: OTHER,
        environment: "ci-ubuntu",
        generatedAt: NOW,
      },
    });
    expect(codes(m)).toContain("DEPLOYED_MISMATCH");
  });

  it("accepts a matching deployed identity", () => {
    const m = manifest({
      release: {
        baseline: "v1.8.0",
        candidate: CANDIDATE,
        deployedIdentity: CANDIDATE,
        environment: "ci-ubuntu",
        generatedAt: NOW,
      },
    });
    expect(run(m).ok).toBe(true);
  });

  // Case 9
  it("blocks a required probe that recorded no oracle evidence", () => {
    const m = manifest({ results: [probe({ oracles: {} })] });
    expect(codes(m)).toContain("MISSING_ORACLE");
  });

  // Case 10
  it("blocks when a fixture was not cleaned up", () => {
    const m = manifest({
      results: [probe({ fixtures: [{ id: "summon-rel-test-9", cleanupStatus: "leaked" }] })],
    });
    expect(codes(m)).toContain("DIRTY_FIXTURE");
  });

  // Case 11
  it("blocks when a critical cadence arc is overdue", () => {
    const m = manifest({
      cadence: [
        {
          obligationId: "ghostty.real-launch",
          risk: "critical",
          intervalDays: 30,
          blocksWhenOverdue: true,
          lastRunAt: "2026-06-27T12:00:00Z", // 31 days before NOW
        },
      ],
    });
    expect(codes(m)).toContain("OVERDUE_ARC");
  });

  it("allows a cadence arc that is still current", () => {
    const m = manifest({
      cadence: [
        {
          obligationId: "ghostty.real-launch",
          intervalDays: 30,
          blocksWhenOverdue: true,
          lastRunAt: "2026-07-20T12:00:00Z",
        },
      ],
    });
    expect(run(m).ok).toBe(true);
  });

  it("blocks a blocking cadence arc that has never run", () => {
    const m = manifest({
      cadence: [
        { obligationId: "ghostty.real-launch", intervalDays: 30, blocksWhenOverdue: true, lastRunAt: null },
      ],
    });
    expect(codes(m)).toContain("OVERDUE_ARC");
  });

  // Case 12
  it("blocks an unsupported schema version", () => {
    expect(codes(manifest({ version: 2 }))).toContain("SCHEMA_VERSION");
  });

  // Case 13
  it("blocks an empty results array", () => {
    expect(codes(manifest({ results: [] }))).toContain("NO_RESULTS");
  });

  // Case 14 — fail closed, do not throw
  it("blocks on a malformed date rather than throwing", () => {
    const m = manifest({
      results: [
        probe(),
        probe({ probeId: "release.optional-thing", required: false, status: "failed" }),
      ],
      exceptions: [
        {
          id: "EX-4",
          probeId: "release.optional-thing",
          reason: "x",
          approvedBy: "maintainer",
          expiresAt: "not-a-date",
        },
      ],
    });
    expect(() => run(m)).not.toThrow();
    expect(codes(m)).toContain("MALFORMED");
  });

  // Case 15
  it("blocks an unknown status value", () => {
    const m = manifest({ results: [probe({ status: "flaky" })] });
    expect(codes(m)).toContain("MALFORMED");
    expect(run(m).ok).toBe(false);
  });

  it("blocks an exception with no approvedBy", () => {
    const m = manifest({
      results: [
        probe(),
        probe({ probeId: "release.optional-thing", required: false, status: "failed" }),
      ],
      exceptions: [
        {
          id: "EX-5",
          probeId: "release.optional-thing",
          reason: "x",
          expiresAt: "2026-12-31T00:00:00Z",
        },
      ],
    });
    expect(codes(m)).toContain("UNAPPROVED_EXCEPTION");
  });

  it("blocks a non-object manifest without throwing", () => {
    for (const bad of [null, "string", 42, []]) {
      expect(() => run(bad)).not.toThrow();
      expect(run(bad).ok).toBe(false);
    }
  });

  it("requires an explicit parseable now", () => {
    const result = analyze(manifest(), { now: "nonsense", expectedCandidate: CANDIDATE });
    expect(result.ok).toBe(false);
    expect(result.blocks[0].code).toBe("MALFORMED");
  });
});

describe("formatBlocks", () => {
  it("returns empty string when ok", () => {
    expect(formatBlocks({ ok: true, blocks: [] })).toBe("");
  });

  it("uses the project BLOCKED/WHY/FIX convention", () => {
    const out = formatBlocks(run(manifest({ results: [probe({ status: "skipped" })] })));
    expect(out).toMatch(/^BLOCKED by analyze-release — /);
    expect(out).toContain("WHY:");
    expect(out).toContain("FIX:");
    expect(out).toContain("ZERO_PASS");
  });
});
