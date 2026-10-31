/**
 * The read side of the record port: the one place that maps a stored `backend` field to what a status read needs
 * (`resolve`, late adoption). It loads only the read halves (ghostty/read.ts, rex/read.ts), never the workspace
 * commands of backends/workspace.ts, so every status read (the monitor's child each tick, `status --once`, `focus`,
 * `open`, `inspect`, `title`) stays small. A record without the field is Ghostty.
 */
import type { BackendId } from "../backend-detect.js";
import type { RecordReader } from "./port.js";
import { resolveGhosttyStatus } from "./ghostty/read.js";
import { adoptUnrecordedRex, resolveRexStatus } from "./rex/read.js";

const GHOSTTY_READER: RecordReader = { resolve: resolveGhosttyStatus };
const REX_READER: RecordReader = { resolve: resolveRexStatus, adoptUnrecorded: adoptUnrecordedRex };

export function recordReaderFor(backend: BackendId | undefined): RecordReader {
  return backend === "rex" ? REX_READER : GHOSTTY_READER;
}
