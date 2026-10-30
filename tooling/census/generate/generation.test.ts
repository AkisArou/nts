import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { generateBatch, parseCells } from "./generation.ts";
import { parseArguments } from "./main.ts";
import { CELLS } from "./scenarios.ts";
import { precheckProgram } from "./precheck.ts";
import { readProgram } from "./writer.ts";

function files(directory: string, prefix = ""): [string, string][] {
  const result: [string, string][] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) result.push(...files(join(directory, entry.name), relative + "/"));
    else result.push([relative, readFileSync(join(directory, entry.name), "utf8")]);
  }
  return result;
}

test("the same seed gives byte-identical verified output in different destinations", () => {
  const root = mkdtempSync(join(tmpdir(), "nts-generator-replay-"));
  try {
    const left = join(root, "left"), right = join(root, "right");
    const a = generateBatch({ seed: 1, count: 10, cells: CELLS, out: left });
    const b = generateBatch({ seed: 1, count: 10, cells: CELLS, out: right });
    assert.equal(a.written, 10);
    assert.equal(a.attempted, 10);
    assert.deepEqual(a.passed, { strict: 10, deterministic: 10, twins: 10, witness: 10 });
    assert.equal(Object.values(a.waste).reduce((sum, value) => sum + value, 0), 0);
    assert.deepEqual(a, b);
    assert.deepEqual(files(left), files(right));
    for (const entry of readdirSync(left, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      const directory = join(left, entry.name);
      const program = readProgram(directory);
      const checked = precheckProgram(directory, program.printed.functions);
      assert.equal(checked.ok, true, `${entry.name}: ${JSON.stringify(checked)}`);
      const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
      assert.ok(manifest.distinguishingInputs.length > 0);
      assert.equal(program.source.startsWith("// run: check\n"), true);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI rejects ambiguous or destructive generation/reduction arguments", () => {
  assert.deepEqual(parseCells("length:merge,bounds:call"), ["length:merge", "bounds:call"]);
  assert.deepEqual(parseCells("all"), CELLS);
  for (const cells of ["", "bounds:call,bounds:call", "whole:call", "bounds:call,"]) {
    assert.throws(() => parseCells(cells));
  }
  for (const args of [[], ["--out"], ["--seed", "-1", "--out", "a"], ["--count", "0", "--out", "a"],
    ["--out", "a", "--out", "b"], ["--out", "a", "--oracle", "b"], ["--reduce", "a"],
    ["--reduce", "a", "--oracle", "b", "--seed", "1"], ["--wat", "x"],
    ["--out", "a", "--seed", "4294967296"]]) assert.throws(() => parseArguments(args));
  assert.equal(parseArguments(["--help"]).mode, "help");
  const generate = parseArguments(["--seed", "0", "--count", "1", "--out", "target"]);
  assert.equal(generate.mode, "generate");
  const reduce = parseArguments(["--reduce", "target", "--oracle", "oracle.ts", "--max-candidates", "0"]);
  assert.equal(reduce.mode, "reduce");
});

test("generation refuses to overwrite a populated output directory", () => {
  const root = mkdtempSync(join(tmpdir(), "nts-generator-existing-"));
  try {
    generateBatch({ seed: 2, count: 1, cells: ["bounds:merge"], out: root });
    const original = files(root);
    assert.throws(() => generateBatch({ seed: 3, count: 1, cells: CELLS, out: root }), /not empty/);
    assert.deepEqual(files(root), original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
