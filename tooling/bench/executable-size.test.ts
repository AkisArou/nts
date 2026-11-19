import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { testScratch } from "../gate/test-scratch.ts";
import { ToolingInstrumentError } from "../gate/step-result.ts";
import { executableSize, fileSize, sharedLibraryPaths, sizeToolchain } from "./executable-size.ts";
import { EXECUTABLE_SIZE_PROTOCOL, checkExecutableSizeCell, type ExecutableSize } from "./executable-size-cell.ts";
import { LAUNCH_COUNT, LAUNCH_PROTOCOL, LAUNCH_WARMUPS, launchCell, type Launch } from "./launch-cell.ts";
import { COLUMNS, COMPARATORS, POLICY, ownBest, parseRun, renderFull, sealRun, type Cell, type RunRecord } from "./run-record.ts";
import { fromNts } from "./run-producers.ts";
import { readLaunchMarker } from "./launch-marker.ts";
import { elfLinkage } from "./layouts-elf.ts";

const hash = "b".repeat(64), output = "c".repeat(64), commit = "a".repeat(40);
const launch: Launch = { wallNanoseconds: 1000, status: 0, signal: null, timedOut: false,
  userMicroseconds: 100, systemMicroseconds: 0, maxRssKib: 1000, siblingTicks: 0, stdoutSha256: output };
const timed = () => launchCell({ protocol: LAUNCH_PROTOCOL, warmups: Array(LAUNCH_WARMUPS).fill(launch),
  launches: Array(LAUNCH_COUNT).fill(launch), stdoutSha256: output, environmentSha256: hash }, { argv: ["/product"], recipe: { tool: "nts build", product: "app.cli", backend: "c", command: ["/nts", "build", "/config", "--out", "/out"], artifactSha256: hash } }, "");
function receipt(shipped = 2000, stripped = 1000): ExecutableSize {
  return { protocol: EXECUTABLE_SIZE_PROTOCOL, shipped: { path: "/product", bytes: shipped, sha256: hash },
    stripped: { path: "/copy", bytes: stripped, sha256: hash },
    clang: { path: "/llvm/clang", version: "clang version 23.1.5", sha256: hash },
    strip: { path: "/llvm/llvm-strip", version: "LLVM version 23.1.5", sha256: hash }, stripArguments: ["--strip-all", "/copy"],
    interpreter: null, needed: [], sharedLibraries: [], sharedLibraryBytes: 0, runtime: "runtime embedded in executable; static libc", strippedLaunch: launch };
}
const sizeCell = (shipped: number, stripped: number): Cell => ({ ...timed(), executableSize: receipt(shipped, stripped) });
const absent = (reason = "no standalone product"): Cell => ({ status: "NOT_PROVIDED", reason, nanoseconds: null, spread: null,
  verified: false, checksum: null, details: null, executableSize: null });
function run(cells: Record<string, Cell> = {}, id = "current", at = "2026-11-19T12:00:00.000Z"): RunRecord {
  return sealRun({ schemaVersion: 1, id: `2026-11-19-${commit}-${id}`, startedAt: at, finishedAt: at, complete: true, inventory: ["size-hello"], columns: [...COLUMNS],
    sourceCommit: commit, compiler: { commit, sha256: hash }, harness: { identity: hash, contract: "size-test-v1", files: [] },
    machine: { identity: "host", conditions: { cpu: 4, load: "1.0" } }, comparators: Object.fromEntries(COMPARATORS.map(c => [c, null])),
    verdictPolicy: POLICY, provenance: null, rows: [{ name: "size-hello", kind: "executable-size", workloadIdentity: hash, eligibleForBest: true,
      conditions: { sizeOracle: timed() }, cells: Object.fromEntries(COLUMNS.map(c => [c, cells[c] ?? absent()])), verdicts: {} }] });
}

test("size cells retain shipped and stripped bytes and both verdicts; losses and absent columns survive the report", () => {
  const record = run({ "nts C": sizeCell(2000, 1000), "nts LLVM": sizeCell(1000, 900), "Bun AOT": sizeCell(100_000, 90_000), ScriptC: sizeCell(1000, 600) });
  const row = record.rows[0]!;
  assert.equal(row.verdicts["nts C"].ScriptC.ratio, 2);
  assert.equal(row.verdicts["nts C"].ScriptC.kind, "LOSS");
  assert.equal(row.strippedVerdicts!["nts C"].ScriptC.ratio, 1000 / 600);
  assert.equal(row.verdicts["nts C"].node.kind, "NOT_COMPARABLE");
  assert.deepEqual(parseRun(record), record);
  const report = renderFull([record], [{ name: "executable-size", pages: ["docs/foundations/memory.md"], rows: [row.name] }]);
  for (const text of ["### As shipped", "### Stripped", "2.000× LOSS", "1.667× LOSS", "0.020× WON", "no standalone product", "shared closure 0 bytes", "CPU", "size-hello"])
    assert.ok(report.toLowerCase().includes(text.toLowerCase()), text);
});

test("control: malformed, missing, zero, mismatched or unsupported size observations are instrument errors, never values", () => {
  const mutations: ((cell: Cell) => void)[] = [
    c => { delete c.executableSize; }, c => { c.executableSize = null; }, c => { c.executableSize!.shipped.bytes = 0; },
    c => { c.executableSize!.stripped.bytes = 0.5; }, c => { c.executableSize!.shipped.sha256 = "d".repeat(64); },
    c => { c.executableSize!.stripped.path = "/product"; }, c => { c.executableSize!.strip.version = "LLVM version 22.1.0"; },
    c => { c.executableSize!.stripArguments = []; }, c => { c.executableSize!.sharedLibraryBytes = 1; },
    c => { c.executableSize!.needed = ["libc.so.6"]; }, c => { c.executableSize!.strippedLaunch.status = 1; },
    c => { c.executableSize!.strippedLaunch.stdoutSha256 = "d".repeat(64); },
  ];
  for (const mutate of mutations) {
    const cell = structuredClone(sizeCell(2000, 1000)); mutate(cell);
    assert.throws(() => checkExecutableSizeCell(cell, "size-hello/C"));
    assert.throws(() => run({ "nts C": cell }));
  }
  const record = structuredClone(run({ "nts C": sizeCell(2000, 1000) }));
  record.rows[0]!.strippedVerdicts!["nts C"].ScriptC.kind = "WON";
  assert.throws(() => parseRun(record), /stripped verdict/);
  assert.throws(() => checkExecutableSizeCell({ ...absent(), executableSize: receipt() }, "absent"), /absent cell/);
});

test("shipped histories survive a different strip, stripped histories do not borrow its measurements or timing spread", () => {
  const earlier = run({ "nts C": sizeCell(2000, 1000), ScriptC: sizeCell(1000, 800) }, "earlier", "2026-11-18T12:00:00.000Z");
  const current = run({ "nts C": sizeCell(2400, 1200), ScriptC: sizeCell(1000, 800) });
  const row = current.rows[0]!;
  assert.equal(ownBest(current, row, "nts C", "ScriptC", [earlier])?.backendSpread, 1);
  assert.equal(ownBest(current, { ...row, sizeView: "stripped" }, "nts C", "ScriptC", [earlier])?.backendValue, 1000);
  row.cells["nts C"]!.executableSize!.strip.sha256 = "d".repeat(64);
  assert.equal(ownBest(current, { ...row, sizeView: "stripped" }, "nts C", "ScriptC", [earlier]), null);
  assert.equal(ownBest(current, row, "nts C", "ScriptC", [earlier])?.backendValue, 2000);
  const detail = row.cells["nts C"]!.details as { recipe: { command: string[] } };
  detail.recipe.command.push("--different-recipe");
  assert.equal(ownBest(current, row, "nts C", "ScriptC", [earlier]), null, "shipped bytes require the same build recipe");
});

test("the producer consumes exact size launch frames and rejects a missing measurement or wrong session commit", () => {
  const sealed = run({ "nts C": sizeCell(2000, 1000), ScriptC: sizeCell(1000, 800) });
  const { rows: _, ...metadata } = sealed;
  const frame = { kind: "executable-size", cells: sealed.rows[0]!.cells, oracle: timed(), floor: {}, provenance: { commit } };
  const raw = (frame: unknown) => ({ lanes: null, cases: ["size-hello"], measured: [{ shown: "size-hello", launch: JSON.stringify(frame) }], spoiled: [] });
  const decoded = fromNts(metadata, raw(frame), { "size-hello": hash });
  assert.equal(decoded.rows[0]!.verdicts["nts C"].ScriptC.ratio, 2);
  assert.throws(() => fromNts(metadata, raw({ ...frame, cells: { ...frame.cells, "nts C": { ...sizeCell(2000, 1000), executableSize: undefined } } })), /malformed launch cell/);
  assert.throws(() => fromNts(metadata, raw({ ...frame, provenance: { commit: "d".repeat(40) } })), /another commit/);
});

test("real ELF products are measured once, stripped privately, and retain libc and loader identities", t => {
  const directory = testScratch(t, "executable-size"), source = join(directory, "probe.c"), binary = join(directory, "product");
  const tools = sizeToolchain();
  writeFileSync(source, '#include <stdio.h>\nint main(void) { puts("size-control"); return 0; }\n');
  const built = spawnSync(tools.clang.path, ["-g", source, "-o", binary], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  const before = fileSize(binary), observation = executableSize(binary, directory, tools, "C libc control");
  assert.deepEqual(fileSize(binary), before);
  assert.equal(observation.shipped.sha256, before.sha256);
  assert.ok(observation.stripped.bytes < observation.shipped.bytes);
  assert.ok(observation.needed.includes("libc.so.6"));
  assert.ok(observation.sharedLibraries.some(f => /libc\.so/.test(f.path)));
  assert.ok(observation.sharedLibraryBytes > 0);
  assert.equal(spawnSync(observation.stripped.path, [], { encoding: "utf8" }).stdout, "size-control\n");
  assert.deepEqual(elfLinkage(readFileSync(binary)), { interpreter: observation.interpreter, needed: observation.needed });
  const bad = join(directory, "bad"), missing = join(directory, "missing"); mkdirSync(bad);
  assert.throws(() => executableSize(missing, bad, tools, "test"), ToolingInstrumentError);
  const invalid = join(directory, "not-elf"); copyFileSync(binary, invalid); writeFileSync(invalid, "not an ELF");
  assert.throws(() => executableSize(invalid, bad, tools, "test"), /ELF/);
  assert.throws(() => elfLinkage(readFileSync(binary).subarray(0, 100)), /ELF/);
  assert.throws(() => sharedLibraryPaths("libc.so.6 => not found"), /unresolved/);
  assert.throws(() => executableSize(binary, bad, { ...tools, strip: { ...tools.strip, path: missing } }, "test"), ToolingInstrumentError);
});

test("the size marker is additive and has no extra fields", t => {
  const root = testScratch(t, "size-marker"), directory = join(root, "benchmarks/cases/size-hello"); mkdirSync(directory, { recursive: true });
  const marker = join(directory, "launch.json");
  writeFileSync(marker, '{"metric":"executable-size"}');
  assert.deepEqual(readLaunchMarker(root, "size-hello"), { metric: "executable-size" });
  writeFileSync(marker, '{"metric":"executable-size","extra":1}');
  assert.throws(() => readLaunchMarker(root, "size-hello"), /exactly/);
});

test("representative size products retain hello, JSON, and the largest source case even if a compiler refuses it", () => {
  const root = fileURLToPath(new URL("../..", import.meta.url)), cases = join(root, "benchmarks/cases");
  const bytes = (directory: string): number => readdirSync(directory, { withFileTypes: true }).reduce((sum, entry) => {
    const path = join(directory, entry.name);
    return sum + (entry.isDirectory() ? bytes(path) : entry.isFile() && entry.name.endsWith(".ts") ? statSync(path).size : 0);
  }, 0);
  const largest = readdirSync(cases, { withFileTypes: true }).filter(entry => entry.isDirectory())
    .map(entry => ({ name: entry.name, bytes: bytes(join(cases, entry.name)) }))
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))[0]!;
  assert.equal(largest.name, "jetstream-flight-planner", "a new largest case must update the representative product, never silently shrink it");
  for (const [name, program] of [["hello", 'import "../startup-hello/case.ts";'], ["json", 'import "../startup-builtins/case.ts";'],
    ["flight-planner", 'import { work } from "../jetstream-flight-planner/case.ts";\nconsole.log(work(1));']]) {
    assert.deepEqual(readLaunchMarker(root, "size-" + name), { metric: "executable-size" });
    assert.equal(readFileSync(join(cases, "size-" + name, "case.ts"), "utf8"), "// Executable-size product; built and launched once per column recipe.\n" + program + "\n");
  }
});
