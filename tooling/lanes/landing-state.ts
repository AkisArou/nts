// Read-only status: neither a dead waiter nor a retained queue file is a verdict.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { heldActions, heldForEntry, heldLandings } from "./held-landings.ts";
export function queuedLandings(state: string, now = Date.now()) {
  const rows = new Map();
  let holds:ReturnType<typeof heldLandings>=[],holdError:string|undefined;
  try{holds=heldLandings(state);}catch(error){holdError=String(error);}
  for (const directory of ["pending", "queue"]) {
    const path = join(state, directory);
    for (const name of existsSync(path) ? readdirSync(path) : []) {
      if (!name.endsWith(".json")) continue;
      try {
        const entry = JSON.parse(readFileSync(join(path, name), "utf8"));
        if (existsSync(join(state, "results", `${entry.id}.json`)) || existsSync(join(state, "submission-dispositions", `${entry.id}.json`))) continue;
        let hold:any=null;
        try{
          const held=heldForEntry(state,entry.id,holds);
          if(held)hold={state:"held",reason:held.batch.reason,run:held.batch.run,prerequisite:held.entry.id===entry.id?null:held.entry.id,actions:heldActions(held)};
        }catch(error){hold={state:"unknown",reason:String(error)};}
        if(holdError)hold={state:"unknown",reason:holdError};
        rows.set(entry.id, { id: entry.id, at: entry.at, sha: String(entry.sha).slice(0, 12), tree: entry.tree, hold,
          unit: entry.unit ?? null, withdrawalRequested: existsSync(join(state, "withdrawals", `${entry.id}.json`)), waitingMin: Math.round((now - entry.at) / 60000) });
      } catch {} // An atomic rename or cleanup can race this read.
    }
  }
  return [...rows.values()].sort((a,b)=>a.at-b.at).map(({at,...row})=>row);
}
