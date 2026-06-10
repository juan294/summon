/** Thrown when Ghostty fails to open a new tab for a workspace launch.
 *  Recoverable for multi-project sessions: callers may skip and continue. */
export class TabOpenError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TabOpenError";
  }
}
