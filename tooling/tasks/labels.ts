// Keep GitHub's labels equal to .github/labels.json: a missing label is made,
// a changed colour or description is written. A label GitHub has and the file
// does not is reported, never deleted: removing one strips it from issues.
//
//   node tooling/tasks/labels.ts sync [--dry-run]
import { pathToFileURL } from "node:url";
import { gh, type Gh } from "./new.ts";
import { readSpec, type Label, type LabelSpec } from "./spec.ts";

export type Plan = { make: Label[]; edit: Label[]; extra: string[] };

/** What a sync would do, from the spec and the labels GitHub has. */
export function syncPlan(spec: LabelSpec, have: readonly Label[]): Plan {
  const by = new Map(have.map(label => [label.name, label]));
  const make = spec.labels.filter(label => !by.has(label.name));
  const edit = spec.labels.filter(label => {
    const there = by.get(label.name);
    return there && (there.color.toLowerCase() !== label.color || there.description !== label.description);
  });
  const named = new Set(spec.labels.map(label => label.name));
  return { make, edit, extra: have.map(label => label.name).filter(name => !named.has(name)).sort() };
}

export function sync(run: Gh, spec: LabelSpec, dry: boolean, say: (line: string) => void): Plan {
  const have = JSON.parse(run(["label", "list", "--limit", "500", "--json", "name,color,description"])) as Label[];
  const plan = syncPlan(spec, have);
  for (const label of plan.make) { say(`make ${label.name}`); if (!dry) run(["label", "create", label.name, "--color", label.color, "--description", label.description]); }
  for (const label of plan.edit) { say(`edit ${label.name}`); if (!dry) run(["label", "edit", label.name, "--color", label.color, "--description", label.description]); }
  for (const name of plan.extra) say(`kept, not in .github/labels.json: ${name}`);
  return plan;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const argv = process.argv.slice(2);
  if (argv[0] !== "sync") { console.error("usage: node tooling/tasks/labels.ts sync [--dry-run]"); process.exitCode = 2; }
  else {
    try { sync(gh, readSpec(), argv.includes("--dry-run"), line => console.log(line)); }
    catch (error) { console.error(`labels: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 2; }
  }
}
