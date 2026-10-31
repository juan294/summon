import { describe, expect, it } from "vitest";
import { editDistance } from "./edit-distance.js";

describe("editDistance (optimal string alignment)", () => {
  it.each([
    ["", "", 0],
    ["abc", "", 3],
    ["", "abc", 3],
    ["kitten", "sitting", 3],
    ["chapa", "chapa", 0],
    ["chpaa", "chapa", 1],
    ["ab", "ba", 1],
    ["abcd", "badc", 2],
    ["summom", "summon", 1],
    ["lazygti", "lazygit", 1],
  ])("%j vs %j = %i", (a, b, expected) => {
    expect(editDistance(a, b)).toBe(expected);
    expect(editDistance(b, a)).toBe(expected);
  });
});
