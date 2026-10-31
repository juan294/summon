import { describe, expect, it } from "vitest";
import { suggestProjects, suggestTargets } from "./suggest.js";

const NAMES = ["chapa", "chapa-cli", "clarity", "coach", "kalpha", "marky", "summon", "sutura", "termplex"];
const NO_RECENCY = (): undefined => undefined;
const recencyFrom = (entries: Record<string, number>) => (name: string): number | undefined => entries[name];

describe("suggestProjects (Phase 6 Unit A, D7)", () => {
  it.each([
    // target, expected
    ["chpaa", ["chapa"]],
    ["cha", ["chapa", "chapa-cli"]],
    ["chapa-cl", ["chapa-cli"]],
    ["CHAPA", ["chapa", "chapa-cli"]],
    ["Cl", ["clarity", "chapa-cli"]],
    ["summom", ["summon"]],
    ["sumon", ["summon"]],
    ["termplx", ["termplex"]],
    ["cpl", ["chapa-cli"]],
    ["zzzzzz", []],
    ["c", []],
    ["\u{1F47B}", []],
    ["", []],
    ["xq", []],
  ])("%j -> %j", (target, expected) => {
    expect(suggestProjects(target, NAMES, NO_RECENCY)).toEqual(expected);
  });

  it("ranks exact prefix before case-insensitive prefix before subsequence before edit distance", () => {
    const names = ["alfa", "a-l-p", "Alphabet", "alps"];
    expect(suggestProjects("alp", names, NO_RECENCY)).toEqual(["alps", "Alphabet", "a-l-p"]);
    expect(suggestProjects("alp", names.filter((n) => n !== "alps"), NO_RECENCY)).toEqual(["Alphabet", "a-l-p", "alfa"]);
  });

  it("sorts alphabetically inside a tier, ignoring case", () => {
    expect(suggestProjects("ca", ["cab", "capsule", "Cazz"], NO_RECENCY)).toEqual(["cab", "capsule", "Cazz"]);
    expect(suggestProjects("ca", ["Cazz", "capsule", "cab"], NO_RECENCY)).toEqual(["cab", "capsule", "Cazz"]);
  });

  it("orders a tier by most recent launch first, then alphabetically", () => {
    const recency = recencyFrom({ "chapa-cli": 2_000, coach: 3_000 });
    expect(suggestProjects("ch", NAMES, recency)).toEqual(["chapa-cli", "chapa", "coach"]);
    expect(suggestProjects("co", ["coach", "cobalt", "copper"], recency)).toEqual(["coach", "cobalt", "copper"]);
    expect(suggestProjects("co", ["cobalt", "copper", "coach"], recencyFrom({ copper: 1 }))).toEqual(["copper", "coach", "cobalt"]);
  });

  it("caps the list at three", () => {
    expect(suggestProjects("sa", ["sa1", "sa2", "sa3", "sa4"], NO_RECENCY)).toEqual(["sa1", "sa2", "sa3"]);
  });

  it("applies the edit-distance tier only to names of four or more characters", () => {
    expect(suggestProjects("abd", ["abc"], NO_RECENCY)).toEqual([]);
    expect(suggestProjects("abcx", ["abcd"], NO_RECENCY)).toEqual(["abcd"]);
    expect(suggestProjects("abcxy", ["abcd"], NO_RECENCY)).toEqual(["abcd"]);
    expect(suggestProjects("abcxyz", ["abcd"], NO_RECENCY)).toEqual([]);
  });

  it("never suggests the same name twice and never returns an exact match", () => {
    expect(suggestProjects("chapa", NAMES, NO_RECENCY)).toEqual(["chapa-cli"]);
    expect(suggestProjects("chap", NAMES, NO_RECENCY)).toEqual(["chapa", "chapa-cli"]);
  });

  it("asks for recency only for names that match, once each", () => {
    const asked: string[] = [];
    const recency = (name: string): number | undefined => { asked.push(name); return undefined; };
    suggestProjects("chap", NAMES, recency);
    expect([...new Set(asked)].sort()).toEqual(["chapa", "chapa-cli"]);
    expect(asked.length).toBe(new Set(asked).size);
  });

  it("does not mutate the input list", () => {
    const names = ["zeta", "alpha", "beta"];
    suggestProjects("al", names, NO_RECENCY);
    expect(names).toEqual(["zeta", "alpha", "beta"]);
  });
});

// Review should-fix (UX-M3): commands need a close match; projects keep the looser tiers.
describe("suggestTargets", () => {
  const COMMANDS = ["status", "session", "focus", "completions", "clean", "list", "layout"];
  it.each([
    ["stauts", [{ name: "status", command: true }]],
    ["sesion", [{ name: "session", command: true }]],
    ["sta", [{ name: "status", command: true }]],
    ["STAT", [{ name: "status", command: true }]],
    ["docs", []],
    ["cli", []],
    ["lsit", [{ name: "list", command: true }]],
  ])("%j -> %j", (target, expected) => {
    expect(suggestTargets(target, [], COMMANDS, NO_RECENCY)).toEqual(expected);
  });

  it("projects still match by subsequence and edit distance", () => {
    expect(suggestTargets("cpl", ["chapa-cli"], COMMANDS, NO_RECENCY)).toEqual([{ name: "chapa-cli", command: false }]);
  });
});
