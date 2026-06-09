/**
 * Canonical glyph vocabulary for summon UI output.
 * Use these symbols consistently across all commands to ensure
 * a uniform visual language regardless of color support.
 */
export const sym = {
  ok: "✓",     // U+2713 — success / pass
  warn: "⚠",   // U+26A0 — warning
  fail: "✗",   // U+2717 — failure
  info: "·",   // middle dot — informational
  bullet: "•", // U+2022 — list item
} as const;
