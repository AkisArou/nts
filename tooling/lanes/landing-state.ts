// Read-only status: neither a dead waiter nor a retained queue file is a verdict.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
export function queuedLandings(state: string, now = Date.now()) {
  const rows = new Map();
  for (const directory of ["pending", "queue"]) {
    const path = join(state, directory);
    for (const name of existsSync(path) ? readdirSync(path) : []) {
      if (!name.endsWith(".json")) continue;
      try {
        const entry = JSON.parse(readFileSync(join(path, name), "utf8"));
        if (existsSync(join(state, "results", `${entry.id}.json`)) || existsSync(join(state, "submission-dispositions", `${entry.id}.json`))) continue;
        rows.set(entry.id, { id: entry.id, at: entry.at, sha: String(entry.sha).slice(0, 12), tree: entry.tree,
          unit: entry.unit ?? null, withdrawalRequested: existsSync(join(state, "withdrawals", `${entry.id}.json`)), waitingMin: Math.round((now - entry.at) / 60000) });
      } catch {} // An atomic rename or cleanup can race this read.
    }
  }
  return [...rows.values()].sort((a,b)=>a.at-b.at).map(({at,...row})=>row);
}
