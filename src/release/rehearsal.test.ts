/**
 * Release-gate rehearsals (playbook Section 13 acceptance criteria).
 *
 * Two positive cases and ten deliberate blocking cases. Each blocking case is a
 * regression for something that actually happened, or that the gate exists to
 * prevent:
 *
 *   B1  zero-pass  -- the bug that was live: a required macOS check that skipped
 *                     its only test and reported green
 *   B5  deployed-identity mismatch -- v1.8.0 was tagged against two different
 *                     trees ten minutes apart
 *   B10 tag before evidence -- v1.4.0 has a tag and a GitHub Release but was
 *                     never published (npm returns 404)
 *
 * These live in the normal suite rather than in a script so they re-run on every
 * commit and cannot silently rot.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT } from "./helpers.js";

// @ts-expect-error -- untyped .mjs module
import { analyze } from "../../scripts/release/analyzer.mjs";
// @ts-expect-error -- untyped .mjs module
import { validateCharter } from "../../scripts/release/validate-charter.mjs";

const NOW = "2026-07-28T12:00:00Z";
const CANDIDATE = "53ad23e48877944dff2b44e3262f1ccb66457eb9";
const OTHER = "12d59df0000000000000000000000000000000aa";

type Row = Record<string, unknown>;

function probe(over: Row = {}): Row {
  return {
    probeId: "release.cli-contract",
    required: true,
    status: "passed",
    owner: "maintainer",
    startedAt: NOW,
    finishedAt: NOW,
    runner: "vitest",
    oracles: { assertions: 3 },
    fixtures: [{ id: "summon-rel-1-1", cleanupStatus: "removed" }],
    ...over,
  };
}

/** A legitimate, complete evidence set for a fixed candidate. */
function goodManifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    release: {
      baseline: "v1.8.0",
      candidate: CANDIDATE,
      deployedIdentity: null,
      environment: "ci-ubuntu",
      generatedAt: NOW,
    },
    results: [
      probe({ probeId: "release.candidate-identity" }),
      probe({ probeId: "release.cli-contract" }),
      probe({ probeId: "release.dry-run-golden" }),
      probe({ probeId: "release.trust-enforcement" }),
      probe({ probeId: "release.dangerous-command-refusal" }),
      probe({ probeId: "release.injection-defense" }),
      probe({ probeId: "release.state-isolation" }),
      probe({ probeId: "release.cleanup" }),
    ],
    cadence: [
      {
        obligationId: "ghostty.real-launch",
        risk: "critical",
        intervalDays: 30,
        blocksWhenOverdue: true,
        lastRunAt: "2026-07-20T12:00:00Z",
      },
    ],
    exceptions: [],
    ...over,
  };
}

const run = (m: unknown, expected = CANDIDATE) =>
  analyze(m, { now: NOW, expectedCandidate: expected });

const codesOf = (m: unknown, expected = CANDIDATE): string[] =>
  run(m, expected).blocks.map((b: { code: string }) => b.code);

describe("rehearsal: positive", () => {
  // P1
  it("P1 a complete evidence set for a fixed candidate passes", () => {
    const result = run(goodManifest());
    expect(result.blocks).toEqual([]);
    expect(result.ok).toBe(true);
  });

  // P2 -- the manifest names exactly the candidate under release, and the
  // cadence arc is current.
  it("P2 the manifest names exactly the candidate and carries a current arc", () => {
    const manifest = goodManifest() as { release: { candidate: string } };
    expect(manifest.release.candidate).toBe(CANDIDATE);
    expect(run(manifest).ok).toBe(true);
    // ...and a different candidate is not silently accepted.
    expect(run(manifest, OTHER).ok).toBe(false);
  });
});

describe("rehearsal: deliberate blocking", () => {
  // B1 -- regression for the bug that was live in CI.
  it("B1 all probes skipped, zero passed", () => {
    const m = goodManifest({
      results: [
        probe({ probeId: "release.cli-contract", status: "skipped" }),
        probe({ probeId: "release.dry-run-golden", status: "skipped" }),
      ],
    });
    expect(codesOf(m)).toContain("ZERO_PASS");
  });

  // B2
  it("B2 one required probe skipped", () => {
    const results = (goodManifest() as { results: Row[] }).results.slice();
    results[3] = probe({ probeId: "release.trust-enforcement", status: "skipped" });
    expect(codesOf(goodManifest({ results }))).toContain("REQUIRED_MISS");
  });

  // B3 -- quarantine must not excuse a required miss.
  it("B3 required probe failed and quarantined by an exception", () => {
    const results = (goodManifest() as { results: Row[] }).results.slice();
    results[3] = probe({ probeId: "release.trust-enforcement", status: "failed" });
    const got = codesOf(
      goodManifest({
        results,
        exceptions: [
          {
            id: "EX-B3",
            probeId: "release.trust-enforcement",
            reason: "flaky",
            risk: "low",
            approvedBy: "maintainer",
            createdAt: NOW,
            expiresAt: "2026-12-31T00:00:00Z",
          },
        ],
      }),
    );
    expect(got).toContain("REQUIRED_MISS");
    expect(got).toContain("EXCEPTION_ON_REQUIRED");
  });

  // B4
  it("B4 manifest candidate differs from the commit being released", () => {
    expect(codesOf(goodManifest(), OTHER)).toContain("CANDIDATE_MISMATCH");
  });

  // B5 -- regression for v1.8.0's two-trees-one-version incident.
  it("B5 deployed identity differs from the verified candidate", () => {
    const m = goodManifest({
      release: {
        baseline: "v1.8.0",
        candidate: CANDIDATE,
        deployedIdentity: OTHER,
        environment: "ci-ubuntu",
        generatedAt: NOW,
      },
    });
    expect(codesOf(m)).toContain("DEPLOYED_MISMATCH");
  });

  // B6
  it("B6 a fixture was left behind", () => {
    const results = (goodManifest() as { results: Row[] }).results.slice();
    results[7] = probe({
      probeId: "release.cleanup",
      fixtures: [{ id: "summon-rel-1-8", cleanupStatus: "leaked" }],
    });
    expect(codesOf(goodManifest({ results }))).toContain("DIRTY_FIXTURE");
  });

  // B7 -- an incomplete charter is not a charter.
  it("B7 a charter report missing maneuver row 5 is invalid and blocks", () => {
    const incomplete = [
      "## Risk hypothesis\n\nx\n",
      "## Maneuvers\n\n| # | Maneuver | Result | Evidence |\n|---:|---|---|---|",
      "| 1 | a | PASS | e |",
      "| 2 | b | PASS | e |",
      "| 3 | c | PASS | e |",
      "| 4 | d | PASS | e |",
      // row 5 deliberately omitted
      "| 6 | f | PASS | e |",
      "| 7 | g | PASS | e |",
      "| 8 | h | PASS | e |",
      "\n## Findings\n\nNone.\n",
      "## Skipped high-risk areas\n\nNone.\n",
      "## Fixtures and cleanup\n\nremoved\n",
      "## Charter decision\n\nPASS\n",
    ].join("\n");

    const validation = validateCharter(incomplete);
    expect(validation.ok).toBe(false);
    expect(validation.violations.map((v: { code: string }) => v.code)).toContain(
      "MISSING_MANEUVER",
    );

    // An invalid charter enters the manifest as a failed required row.
    const results = (goodManifest() as { results: Row[] }).results.slice();
    results.push(
      probe({
        probeId: "charter.launch-pipeline",
        status: "failed",
        oracles: { report: "docs/release/charters/x.md" },
      }),
    );
    expect(codesOf(goodManifest({ results }))).toContain("REQUIRED_MISS");
  });

  // B8
  it("B8 a critical cadence arc is overdue", () => {
    const m = goodManifest({
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
    expect(codesOf(m)).toContain("OVERDUE_ARC");
  });

  // B9
  it("B9 an exception is past its expiry", () => {
    const results = (goodManifest() as { results: Row[] }).results.slice();
    results.push(probe({ probeId: "release.optional", required: false, status: "failed" }));
    const got = codesOf(
      goodManifest({
        results,
        exceptions: [
          {
            id: "EX-B9",
            probeId: "release.optional",
            reason: "stale",
            risk: "low",
            approvedBy: "maintainer",
            createdAt: "2026-01-01T00:00:00Z",
            expiresAt: "2026-07-01T00:00:00Z",
          },
        ],
      }),
    );
    expect(got).toContain("EXPIRED_EXCEPTION");
  });

  // B10 -- regression for v1.4.0: a tag and GitHub Release with no artifact.
  it("B10 tagging cannot precede the evidence gate", () => {
    // With no evidence at all, the analyzer blocks -- so the checklist's
    // tag step (7) is unreachable until step 5 has produced a passing manifest.
    expect(codesOf(goodManifest({ results: [] }))).toContain("NO_RESULTS");

    // And the release workflow runs the analyzer before publish, with no
    // continue-on-error, so a failure cannot be stepped over.
    const workflow = readFileSync(
      join(PROJECT_ROOT, ".github", "workflows", "release.yml"),
      "utf-8",
    );
    const analyzeIndex = workflow.indexOf("Analyze evidence (blocks the release)");
    const publishIndex = workflow.indexOf("\n      - name: Publish");
    expect(analyzeIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(-1);
    expect(analyzeIndex).toBeLessThan(publishIndex);

    // Scope to the analyze step itself (up to the next step), and look for the
    // real YAML key rather than the phrase, which also appears in a comment.
    const afterAnalyze = workflow.slice(analyzeIndex);
    const nextStep = afterAnalyze.indexOf("\n      - name:");
    const analyzeStep = afterAnalyze.slice(0, nextStep === -1 ? undefined : nextStep);
    expect(analyzeStep).toContain("pnpm analyze:release");
    expect(analyzeStep).not.toMatch(/^\s*continue-on-error:/m);
  });
});

describe("rehearsal: the gate is wired into CI", () => {
  it("the Release probes job exists and runs the analyzer", () => {
    const ci = readFileSync(join(PROJECT_ROOT, ".github", "workflows", "ci.yml"), "utf-8");
    expect(ci).toContain("name: Release probes");
    expect(ci).toContain("pnpm test:release");
    expect(ci).toContain("pnpm analyze:release");
  });

  it("the cadence obligation is registered", () => {
    const cadencePath = join(PROJECT_ROOT, "docs", "release", "evidence", "cadence.json");
    expect(existsSync(cadencePath)).toBe(true);
    const cadence = JSON.parse(readFileSync(cadencePath, "utf-8")) as {
      obligations: Array<{ obligationId: string; blocksWhenOverdue: boolean }>;
    };
    const arc = cadence.obligations.find((o) => o.obligationId === "ghostty.real-launch");
    expect(arc?.blocksWhenOverdue).toBe(true);
  });
});

describe("rehearsal: release promotion preserves branch ancestry", () => {
  const releaseAuthorityMarkers = new Map([
    ["CLAUDE.md", "Release to production via a **merge-commit** PR"],
    [
      ".claude/commands/release.md",
      "fixed: `develop` -> `main` merge\ncommit",
    ],
    [
      "docs/release/release-checklist.md",
      "gh pr merge --merge --auto",
    ],
    [
      "docs/release/e2e-pro-playbook.md",
      "| Merge strategy | merge commit for `develop` -> `main`",
    ],
  ]);
  const releaseAuthorities = new Map(
    [...releaseAuthorityMarkers].map(([path]) => [
      path,
      readFileSync(join(PROJECT_ROOT, path), "utf-8"),
    ]),
  );
  const checklist = releaseAuthorities.get("docs/release/release-checklist.md") ?? "";

  it("requires a merge commit and rejects squash commands on the release path", () => {
    for (const [path, marker] of releaseAuthorityMarkers) {
      const source = releaseAuthorities.get(path) ?? "";
      expect(source).toContain(marker);
      expect(source).not.toMatch(/\bgh\s+pr\s+merge\b[^\n]*\s--squash\b/);
    }
  });

  it("does not require a recurring main-to-develop back-merge", () => {
    const mergeCommands = checklist
      .split("\n")
      .filter((line) => /\bgit\s+merge(?:\s|$)/.test(line));

    expect(mergeCommands).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/\b(?:origin\/)?main\b/)]),
    );
  });
});
