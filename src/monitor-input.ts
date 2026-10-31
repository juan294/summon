/** Terminal replies and user keys share one byte stream. Never dispatch CSI payload as keys. */
export type MonitorInput =
  | { type: "key"; bytes: string }
  | { type: "mode"; status: number }
  | { type: "visibility"; status: number };

export function createMonitorInputDecoder() {
  let state: "key" | "escape" | "csi" | "discard" | "discard-escape" = "key";
  let pending = "";
  let deadline: number | null = null;
  const reset = () => {
    state = "key";
    pending = "";
    deadline = null;
  };
  /** A lone ESC that expires is the Esc key; a late `[` after it is still quarantined as a reply. */
  const expire = (now: number): MonitorInput[] => {
    if (deadline === null || now < deadline) return [];
    const lone = state === "escape";
    state = lone ? "discard-escape" : "discard";
    pending = "";
    deadline = null;
    return lone ? [{ type: "key", bytes: "\x1b" }] : [];
  };
  return {
    reset,
    expire,
    pendingDeadline: () => deadline,
    push(chunk: Buffer | string, now: number): MonitorInput[] {
      const events = expire(now);
      for (const byte of chunk.toString()) {
        if (byte === "\x03") {
          events.push({ type: "key", bytes: byte });
          reset();
          continue;
        }
        if (byte === "\x1b") {
          state = "escape";
          pending = byte;
          deadline = now + 100;
          continue;
        }
        if (state === "discard-escape") {
          if (byte === "[") {
            state = "discard";
            continue;
          }
          reset(); // Any other byte is an ordinary key.
        }
        if (state === "key") {
          if (byte === "\r" || byte === "\n" || byte >= " ")
            events.push({ type: "key", bytes: byte });
          continue;
        }
        if (state === "escape") {
          if (byte === "[") {
            state = "csi";
            pending += byte;
          } else reset(); // Unknown escape is consumed together, including Alt+q.
          continue;
        }
        const code = byte.charCodeAt(0);
        const final = code >= 0x40 && code <= 0x7e;
        if (state === "discard") {
          if (final) reset();
          continue;
        }
        // C0 in a CSI is not an Enter/key event. Quarantine malformed sequences.
        if (code < 0x20 || code > 0x7e || pending.length >= 256) {
          state = "discard";
          pending = "";
          deadline = null;
          if (final) reset();
          continue;
        }
        pending += byte;
        if (!final) continue;
        const body = pending.slice(2);
        const mode = /^\?2033;(\d+)\$y$/.exec(body);
        const visibility = /^\?999;(\d+)n$/.exec(body);
        if (mode) events.push({ type: "mode", status: Number(mode[1]) });
        else if (visibility)
          events.push({ type: "visibility", status: Number(visibility[1]) });
        else if (/^[AB]$/.test(body))
          events.push({ type: "key", bytes: pending });
        reset();
      }
      return events;
    },
  };
}
