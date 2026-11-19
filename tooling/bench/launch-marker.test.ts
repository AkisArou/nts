import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { testScratch } from "../gate/test-scratch.ts";
import { benchmarkCases } from "./build-records.ts";
import { peakRssProgram, readLaunchMarker } from "./launch-marker.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DOMAIN = { version: 1, functions: { work: { n: { min: 0, max: 14, integer: true, reason: "bounded" } } } };

/** A tree holding one throughput case with `domains`, and launch case `name` with `marker` and `program`. */
function tree(t: { after(fn: () => void): void }, marker: unknown, program?: string, domains: unknown = DOMAIN): string {
  const root = testScratch(t, "launch-marker"), cases = join(root, "benchmarks/cases");
  mkdirSync(join(cases, "trees"), { recursive: true });
  writeFileSync(join(cases, "trees/case.ts"), "export function work(n: number): number { return n; }\nexport const seed = 1;\n");
  if (domains !== null) writeFileSync(join(cases, "trees/case.domains.json"), JSON.stringify(domains));
  mkdirSync(join(cases, "rss-trees"), { recursive: true });
  writeFileSync(join(cases, "rss-trees/launch.json"), typeof marker === "string" ? marker : JSON.stringify(marker));
  const sized = marker && typeof marker === "object" ? marker as { case: string; function: string; input: number } : null;
  writeFileSync(join(cases, "rss-trees/case.ts"), program ?? (sized?.case ? peakRssProgram(sized) : "console.log(1);\n"));
  return root;
}
const peak = (change: object = {}) => ({ metric: "peak-rss", case: "trees", function: "work", input: 12, ...change });

test("a launch marker is a startup row's exact metric, or a peak-RSS row's workload inside its declared domain", t => {
  assert.deepEqual(readLaunchMarker(tree(t, { metric: "launch-to-exit" }), "rss-trees"), { metric: "launch-to-exit" });
  assert.deepEqual(readLaunchMarker(tree(t, peak()), "rss-trees"), { metric: "peak-rss", case: "trees", function: "work", input: 12 });
  assert.deepEqual(readLaunchMarker(tree(t, peak({ input: 14 })), "rss-trees").metric, "peak-rss", "the domain's maximum is inside it");
  assert.equal(peakRssProgram({ case: "trees", function: "work", input: 12 }).split("\n").slice(-3).join("\n"),
    'import { work } from "../trees/case.ts";\nconsole.log(work(12));\n');
});

test("control: a marker that is not exactly one of the two forms, or a peak-RSS row its domain or program does not support, is refused", t => {
  const refused: [string, string, unknown, string?, unknown?][] = [
    ["not JSON", "is not JSON", "launch-to-exit"],
    ["an array", "is not an object", [1]],
    ["an unknown metric", "unknown metric", { metric: "launch" }],
    ["no metric", "unknown metric", {}],
    ["a startup marker with a stray field", "exactly", { metric: "launch-to-exit", x: 1 }],
    ["a peak-RSS marker with a stray field", "exactly", peak({ x: 1 })],
    ["a peak-RSS marker missing its input", "exactly", (({ input: _, ...rest }) => rest)(peak())],
    ["an input that is not a number", "finite number", peak({ input: "12" })],
    ["an input that is not finite", "finite number", peak({ input: null })],
    ["a case that is not a case", "not a benchmark case", peak({ case: "missing" })],
    ["a function that is not an identifier", "identifier", peak({ function: "work()" })],
    ["an input above the domain", "above trees's declared maximum 14", peak({ input: 15 })],
    ["an input below the domain", "below trees's declared minimum 0", peak({ input: -1 })],
    ["a fraction where the domain wants an integer", "not an integer", peak({ input: 12.5 })],
    ["a function the domain does not declare", "declares no domain for run", peak({ function: "run" })],
    ["a case with no domain", "declares no input domain", peak(), undefined, null],
    ["a domain that does not parse", "case.domains.json", peak(), undefined, { version: 2, functions: {} }],
    ["a two-parameter domain", "declares 2 parameters", peak(), undefined,
      { version: 1, functions: { work: { n: { reason: "a" }, m: { reason: "b" } } } }],
    ["a program that is not the derived one", "is not the program its marker derives", peak(), 'import { work } from "../trees/case.ts";\nconsole.log(work(13));\n'],
    ["a program with an edited comment", "is not the program its marker derives", peak(), "// mine\n" + peakRssProgram({ case: "trees", function: "work", input: 12 })],
  ];
  for (const [what, message, marker, program, domains] of refused) {
    const root = tree(t, marker, program, domains === undefined ? DOMAIN : domains);
    assert.throws(() => readLaunchMarker(root, "rss-trees"), (error: Error) => error.message.includes(message), what);
  }
  // A peak-RSS row cannot be measured on another launch row.
  const root = tree(t, peak());
  writeFileSync(join(root, "benchmarks/cases/trees/launch.json"), JSON.stringify({ metric: "launch-to-exit" }));
  assert.throws(() => readLaunchMarker(root, "rss-trees"), /itself a launch row/);
});

test("every committed launch marker reads through its one reader: the startup rows are launch-to-exit", () => {
  const cases = readdirSync(join(ROOT, "benchmarks/cases")).filter(name => existsSync(join(ROOT, "benchmarks/cases", name, "launch.json"))).sort();
  const markers = new Map(cases.map(name => [name, readLaunchMarker(ROOT, name)]));
  for (const name of ["startup-builtins", "startup-empty", "startup-hello"]) assert.deepEqual(markers.get(name), { metric: "launch-to-exit" }, name);
  // A committed peak-RSS row is named for its case and input, is a benchmark case, and is exactly its derived program.
  const all = benchmarkCases(ROOT);
  for (const [name, marker] of markers) {
    if (marker.metric !== "peak-rss") continue;
    assert.equal(name, `rss-${marker.case}-${marker.input}`, "a peak-RSS row is named for its case and input");
    assert.ok(all.includes(`benchmarks/cases/${name}`));
    assert.equal(readFileSync(join(ROOT, "benchmarks/cases", name, "case.ts"), "utf8"), peakRssProgram(marker));
  }
});
