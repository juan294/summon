import type { TerminalBackend } from "../ghostty.js";

/** Message printed while the Rex launch path is not shipped (Phase 3 of the Rex backend plan). */
export const REX_NOT_AVAILABLE_MSG = "Rex backend is not available in this version";

/**
 * Rex adapter seam. Phase 2 ships the dry run only (the launcher prints the `session.create`
 * request from `layout.ts`); Phase 3 fills in the launch methods with `createWorkspace`.
 */
export const RexBackend: TerminalBackend = {
  id: "rex",
  async launchTraditional() {
    throw new Error(REX_NOT_AVAILABLE_MSG);
  },
  async launchTree() {
    throw new Error(REX_NOT_AVAILABLE_MSG);
  },
};
