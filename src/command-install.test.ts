import { describe, it, expect } from "vitest";
import { commandFixHint } from "./command-install.js";

// Moved from launcher.test.ts with the command checks (AR-M2); the install prompt is covered there through launch().
describe("absolute command paths and fix hints", () => {
  it("commandFixHint keeps summon set for config keys and names the layout for pane keys", () => {
    expect(commandFixHint("editor")).toBe("change your config with: summon set editor <command>");
    expect(commandFixHint("shell", "mywork")).toBe("change your config with: summon set shell <command>");
    expect(commandFixHint("pane.enhance", "mywork")).toBe("change `pane.enhance=` in layout mywork: summon layout edit mywork");
    expect(commandFixHint("pane.enhance")).toBe("change `pane.enhance=` in your layout file");
  });
});
