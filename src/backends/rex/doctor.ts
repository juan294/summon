/**
 * The Rex section of `summon doctor` (AR-M1, moved from commands/doctor.ts): the CLI, its version, the server and
 * the connected apps. The server counts as a check only when this shell launches in Rex; otherwise it is informational.
 */
import type { Detection, RexDiscovery } from "../../backend-detect.js";
import { escapeControlChars } from "../../pane-inventory.js";
import { createRexCli, defaultRexServer, discoverRex, whoamiOf } from "./cli.js";
import { listAppClients } from "./app.js";

/** Where the `rex` CLI is; doctor shares the one lookup with backend detection. */
export function discoverRexForDoctor(): RexDiscovery {
  return discoverRex();
}

export interface RexDoctorInput {
  discovery: RexDiscovery;
  detection: Detection;
  /** Counts one check (doctor's summary). */
  record: (ok: boolean) => void;
  /** The Ghostty-only keys of the user's config; read only when the Rex CLI is found. */
  ignoredConfigKeys: () => string[];
  pass: string;
  fail: string;
}

export function printRexChecks({ discovery, detection, record, ignoredConfigKeys, pass: PASS, fail: FAIL }: RexDoctorInput): void {
  if (discovery.path === null) {
    console.error(`  - Rex CLI not found (searched ${discovery.searched.join(", ")}); not applicable`);
    return;
  }
  const rexContext = detection.ok && detection.backend === "rex" ? detection : null;
  const server = rexContext?.server ?? defaultRexServer();
  const cli = createRexCli(discovery.path, server);
  console.error(`  ${PASS}  Rex CLI found at ${discovery.path}`);
  const version = cli.call("version", ["version"]);
  const versionLines = version.ok ? version.stdout.split("\n").map(escapeControlChars) : [];
  record(version.ok);
  console.error(version.ok
    ? `  ${PASS}  ${versionLines[0] ?? ""} (${versionLines.find((line) => line.startsWith("api:")) ?? "api revision unknown"})`
    : `  ${FAIL}  rex version failed: ${version.reason}`);
  const who = whoamiOf(cli);
  // The server is required only when Rex is the backend of this shell; otherwise it is informational.
  record(rexContext ? who.answers : true);
  if (who.answers) console.error(`  ${PASS}  Rex server reachable at ${server} (host ${who.hostId})`);
  else console.error(`  ${rexContext ? FAIL : "INFO"}  Rex server not reachable at ${server} (${who.reason}); open the Rex app to start it`);
  if (who.answers) {
    const clients = listAppClients(cli, { includeLost: true });
    if (!clients.ok) {
      console.error(`  INFO  app clients unavailable (${clients.reason})`);
    } else if (clients.clients.length === 0) {
      console.error("  INFO  no Rex app connected; open Rex to show workspaces");
    } else {
      for (const client of clients.clients) {
        console.error(`    app client ${client.clientId} ${client.label ? `(${client.label}) ` : ""}${client.connectionState}`);
      }
    }
  }
  console.error(detection.ok
    ? `  INFO  this shell launches in ${detection.backend} (placement ${detection.placement}${detection.backend === "rex" ? `, server ${detection.server}` : ""})`
    : `  INFO  this shell cannot launch: ${detection.reason}`);
  const ignored = ignoredConfigKeys();
  if (ignored.length > 0) console.error(`  INFO  Rex ignores these Ghostty settings from your config: ${ignored.join(", ")}`);
}
