import assert from "node:assert/strict";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { spawnTest } from "../gate/test-wait.ts";
import { newTestScratch } from "../gate/test-scratch.ts";
import { benchmarkGroups, groupRows, parseRowLists, readBenchmarkGroups, rowLists } from "./groups.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

test("only backticked list items inside a Rows section declare rows", () => {
  const text = [
    "- `prose`",
    "## Rows",
    "A `mentioned` row in prose is not a declaration.",
    "### maps",
    "- `map-and-set`",
    "- `map-word-counts`, `str-map-keys`",
    "```md",
    "- `example`",
    "```",
    "## Evidence",
    "- `not-a-row`",
  ].join("\n");
  assert.deepEqual(parseRowLists("docs/foundations/objects.md", text), [
    { page: "docs/foundations/objects.md", name: "maps", rows: ["map-and-set"] },
    { page: "docs/foundations/objects.md", name: "maps", rows: ["map-word-counts", "str-map-keys"] },
  ]);
});

test("lists under one name merge across pages, each row once, unknown groups have no rows", () => {
  const groups = benchmarkGroups([
    { page: "docs/foundations/objects.md", name: "maps", rows: ["a", "b"] },
    { page: "docs/foundations/hashing.md", name: "maps", rows: ["b", "c"] },
    { page: "docs/foundations/hashing.md", name: "hashing", rows: ["c"] },
  ]);
  assert.deepEqual(groups, [
    { name: "maps", pages: ["docs/foundations/objects.md", "docs/foundations/hashing.md"], rows: ["a", "b", "c"] },
    { name: "hashing", pages: ["docs/foundations/hashing.md"], rows: ["c"] },
  ]);
  assert.deepEqual(groupRows(groups, "maps"), ["a", "b", "c"]);
  assert.equal(groupRows(groups, "nope"), undefined);
});

test("the pages in this tree name the map and hashing rows, and every named row exists", () => {
  const groups = readBenchmarkGroups(ROOT);
  const cases = new Set(readdirSync(join(ROOT, "benchmarks/cases"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name));
  assert.deepEqual(groupRows(groups, "maps"), [
    "jetstream-hash-map", "map-and-set", "map-entries-top-k", "map-literal-keys",
    "map-word-counts", "str-map-keys", "symbol-keyed-map", "symbol-keys",
  ]);
  assert.ok(groupRows(groups, "hashing")?.includes("record-word-counts"));
  for (const group of groups) for (const row of group.rows) assert.ok(cases.has(row), `${group.name} names missing row ${row}`);
});

test("the run-session authority resolves a group and refuses an unknown one", t => {
  const root = newTestScratch("bench-group-session");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "docs/foundations"), { recursive: true });
  writeFileSync(join(root, "docs/foundations/objects.md"), "## Rows\n\n### maps\n\n- `map-and-set`\n");
  const session = fileURLToPath(new URL("./run-session.ts", import.meta.url));
  const known = spawnTest(process.execPath, [session, "group", root, "maps"], { encoding: "utf8" });
  assert.equal(known.status, 0, known.stderr);
  assert.deepEqual(JSON.parse(known.stdout), ["map-and-set"]);
  const unknown = spawnTest(process.execPath, [session, "group", root, "nope"], { encoding: "utf8" });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /unknown benchmark group `nope`/);
});

test("row lists read this tree's foundations in page order", () => {
  const lists = rowLists(ROOT);
  assert.ok(lists.some((list) => list.page === "docs/foundations/objects.md" && list.name === "maps"));
});
