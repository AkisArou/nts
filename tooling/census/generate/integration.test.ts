import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import type { FunctionSpec, NumberValue, ProgramModel } from "./model.ts";
import { precheckProgram } from "./precheck.ts";
import { generateModel } from "./scenarios.ts";
import { ROOT, finishManifest, readProgram, writeProgram } from "./writer.ts";

function temporary(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), "nts-generator-contract-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function smallModel(): ProgramModel {
  const model = generateModel(17, 0, "bounds:call");
  return { ...model, policies: { ...model.policies,
    placement: "function", inputSource: "parameter", container: "variable",
    indirection: "direct", chainLength: 0, nestingDepth: 0, context: [],
    twins: true, mutation: "pop", value: 7,
  } };
}

function inventory(inputs: NumberValue[][] = [[-1], [0], [1]]): FunctionSpec[] {
  return [
    { name: "subject", role: "subject", parameters: ["number"], inputs, counterpart: "control" },
    { name: "control", role: "control", parameters: ["number"], inputs },
    { name: "twin", role: "twin", parameters: ["number"], inputs, counterpart: "subject" },
  ];
}

const BASE = `// run: check
export function subject(n: number): number { return n > 0 ? 1 : 0; }
export function control(n: number): number { return 0; }
export function twin(n: number): number { return n > 0 ? 1 : 0; }
`;

function checkSource(t: TestContext, source: string, functions = inventory()) {
  const directory = temporary(t);
  writeProgram(directory, smallModel(), { source });
  return precheckProgram(directory, functions);
}

test("the directory test entry imports every test file exactly once", () => {
  const directory = fileURLToPath(new URL("./", import.meta.url));
  const expected = readdirSync(directory).filter(name => name.endsWith(".test.ts")).sort();
  const entry = readFileSync(join(directory, "index.ts"), "utf8");
  const imported = [...entry.matchAll(/^import ["']\.\/([^"']+\.test\.ts)["'];$/gm)]
    .map(match => match[1]).sort();
  assert.deepEqual(imported, expected);
});

test("prechecks execute an independently written subject, control and twin", (t) => {
  const result = checkSource(t, BASE);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.passed, { strict: true, deterministic: true, twins: true, witness: true });
  assert.deepEqual(result.distinguishingInputs, [{ subject: "subject", control: "control", arguments: [1] }]);
});

test("strict checking rejects a cast-free invalid assignment before Node runs", (t) => {
  const result = checkSource(t, BASE.replace("return n > 0 ? 1 : 0;", "const x: number = 'wrong'; return x;"));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "typecheck");
  assert.match(result.detail, /TS2322|not assignable/);
  assert.deepEqual(result.passed, { strict: false, deterministic: false, twins: false, witness: false });
});

test("repeated calls reject state that fresh processes alone would miss", (t) => {
  const source = BASE.replace("// run: check\n", "// run: check\nlet count: number = 0;\n")
    .replace("return n > 0 ? 1 : 0;", "count++; return count;");
  const result = checkSource(t, source);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "nondeterministic");
  assert.equal(result.passed.strict, true);
  assert.equal(result.passed.deterministic, false);
});

test("undeclared extra exports are not silently omitted from prechecks", (t) => {
  const result = checkSource(t, BASE + "export function forgotten(): number { return 9; }\n");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "node-error");
  assert.match(result.detail, /export inventory/);
});

test("a deleted export is not counted as an agreeing twin", (t) => {
  const source = BASE.replace("export function twin(n: number): number { return n > 0 ? 1 : 0; }\n", "");
  const result = checkSource(t, source);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "node-error");
  assert.match(result.detail, /export inventory/);
});

test("a deterministic twin disagreement fails before the witness check", (t) => {
  const source = BASE.replace("export function twin(n: number): number { return n > 0 ? 1 : 0; }",
    "export function twin(n: number): number { return n > 0 ? 2 : 0; }");
  const result = checkSource(t, source);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "twin-mismatch");
  assert.deepEqual(result.passed, { strict: true, deterministic: true, twins: false, witness: false });
});

test("a route with no distinguishing input is waste even when all twins agree", (t) => {
  const result = checkSource(t, BASE.replaceAll("n > 0 ? 1 : 0", "0"));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "no-witness");
  assert.deepEqual(result.passed, { strict: true, deterministic: true, twins: true, witness: false });
});

test("Node observations distinguish negative zero, NaN and undefined", (t) => {
  const source = `// run: check
export function subject(n: number): number | undefined { return n === 1 ? undefined : n; }
export function control(n: number): number { return 0; }
export function twin(n: number): number | undefined { return n === 1 ? undefined : n; }
`;
  const result = checkSource(t, source, inventory([["-0"], ["NaN"], [1]]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.distinguishingInputs.map((witness) => witness.arguments), [["-0"], ["NaN"], [1]]);
  assert.deepEqual(result.observations[0].values, [
    { kind: "number", value: "-0" }, { kind: "number", value: "NaN" }, { kind: "undefined" },
  ]);
});

test("writer supplies absolute fixture inheritance and both identical domain locations", (t) => {
  const directory = temporary(t);
  const written = writeProgram(directory, smallModel());
  const config = JSON.parse(readFileSync(join(directory, "tsconfig.json"), "utf8"));
  assert.equal(isAbsolute(config.extends), true);
  assert.equal(config.extends, resolve(ROOT, "tsconfig.fixtures.json"));
  assert.equal(config.compilerOptions.strict, true);
  assert.equal(readFileSync(join(directory, "main.domains.json"), "utf8"),
    readFileSync(join(directory, "src", "main.domains.json"), "utf8"));
  assert.deepEqual(JSON.parse(readFileSync(join(directory, "src", "main.domains.json"), "utf8")), written.printed.domains);
  assert.equal(written.source.startsWith("// run: check\n"), true);
  const checked = precheckProgram(directory, written.printed.functions);
  assert.equal(checked.ok, true, !checked.ok ? checked.detail : "");
  if (!checked.ok) return;
  finishManifest(directory, checked.distinguishingInputs);
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.distinguishingInputs, checked.distinguishingInputs);
  assert.equal(manifest.generatorVersion, written.manifest.generatorVersion);
});

test("switching to literal inputs removes stale sidecars from a reduction workspace", (t) => {
  const directory = temporary(t);
  const model = smallModel();
  writeProgram(directory, model);
  assert.equal(existsSync(join(directory, "src", "main.domains.json")), true);
  writeProgram(directory, { ...model, policies: { ...model.policies, inputSource: "literal" } });
  assert.equal(existsSync(join(directory, "main.domains.json")), false);
  assert.equal(existsSync(join(directory, "src", "main.domains.json")), false);
});

test("reading a hand-reduced program preserves its real text rather than recreating it", (t) => {
  const directory = temporary(t);
  const written = writeProgram(directory, smallModel());
  const source = written.source + "\nconst handReductionMarker: number = 1;\n";
  writeFileSync(join(directory, "src", "main.ts"), source);
  const loaded = readProgram(directory);
  assert.equal(loaded.source, source);
  assert.equal(loaded.manifest.sourcePhase, "text");
  assert.notEqual(loaded.manifest.sourceHash, written.manifest.sourceHash);
});

test("the reduction CLI loads an oracle module and writes a separately verified finding", (t) => {
  const workspace = temporary(t);
  const directory = join(workspace, "original");
  const out = join(workspace, "reduced");
  const written = writeProgram(directory, smallModel());
  const oraclePath = join(workspace, "fake-oracle.ts");
  writeFileSync(oraclePath, `
interface FunctionContract { name: string; role: string; counterpart?: string; shortcut?: string }
interface Request { functions: FunctionContract[]; backends: string[] }
function agrees(functions: number) {
  return { version: 1, status: "agrees",
    counts: { functions, expected: functions, compared: functions, unavailable: 0, runtime_declined: 0,
      timeouts: 0, approximated: 0, disagreements: 0, aborts: 0 },
    oracle: { expected: functions, received: functions, complete: true },
    refusals: [], disagreements: [], aborts: [], error: null };
}
// Deliberately invented compiler answers, only for testing this adapter boundary.
export function evaluate(request: Request) {
  const controls = request.functions.filter(fn => fn.role === "control");
  const observed = request.functions.filter(fn => fn.role === "control"
    || fn.role === "twin" && controls.some(control => control.name === fn.counterpart));
  return { version: 1,
    failure: { kind: "wrong-answer", signature: "fake-stage-one-cli", backends: ["c"] },
    backends: request.backends.map(backend => {
      const agreement = agrees(request.functions.length);
      const disagreement = { ...agreement, status: "disagrees",
        counts: { ...agreement.counts, disagreements: 1 },
        disagreements: [{ compiled: "stale", node: "fresh" }] };
      return { backend, check: backend === "c" ? disagreement : agreement,
        controls: observed.map(fn => ({ name: fn.name, check: agrees(1),
          shortcuts: [{ expectation: fn.shortcut ?? controls.find(control => control.name === fn.counterpart)?.shortcut,
            status: "pass", use: "present" }] })) };
    }) };
}
`);
  const run = spawnSync(process.execPath, [fileURLToPath(new URL("./main.ts", import.meta.url)),
    "--reduce", directory, "--oracle", oraclePath, "--out", out, "--max-candidates", "0"],
  { encoding: "utf8", timeout: 30_000 });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}\n${run.error?.message ?? ""}`);
  assert.match(run.stdout, /program hash: [0-9a-f]{64}/);
  assert.equal(readFileSync(join(directory, "src", "main.ts"), "utf8"), written.source);
  assert.equal(readFileSync(join(out, "src", "main.ts"), "utf8"), written.source);
  const reduction = JSON.parse(readFileSync(join(out, "reduction.json"), "utf8"));
  assert.equal(reduction.signature.oracleSignature, "fake-stage-one-cli");
  assert.deepEqual(reduction.signature.backends, ["c"]);
  assert.equal(reduction.stats.attempted, 0);
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  assert.ok(manifest.distinguishingInputs.length > 0);
});
