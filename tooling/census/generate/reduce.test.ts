import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reduceProgram, statementDeletionCandidates } from "./reduce.ts";
import { precheckProgram } from "./precheck.ts";
import type { ReductionCandidate } from "./reduce.ts";
import type { OracleRequest, OracleResult } from "./oracle.ts";
import type { CheckReport } from "../../differential/check-report-types.ts";
import type { FunctionSpec } from "./model.ts";

function agrees(functions = 1): CheckReport {
  return {
    version: 1, status: "agrees",
    counts: { functions, expected: 2 * functions, compared: 2 * functions, unavailable: 0, runtime_declined: 0,
      timeouts: 0, approximated: 0, disagreements: 0, aborts: 0 },
    oracle: { expected: 2 * functions, received: 2 * functions, complete: true }, refusals: [], disagreements: [], aborts: [], error: null,
  };
}
function disagrees(functions = 1): CheckReport {
  const report = agrees(functions);
  report.status = "disagrees";
  if (report.counts !== null) report.counts.disagreements = 1;
  report.disagreements = [{ node: "undefined", compiled: "40" }];
  return report;
}

test("text reduction deletes whole multiline statements, not arbitrary lines", () => {
  const source = `export function f(x: number): number {\n  const rows: number[] = [\n    1,\n    2\n  ];\n  if (x > 0) {\n    rows.push(x);\n  }\n  return rows.length;\n}\n`;
  const candidates = [...statementDeletionCandidates(source)];
  assert.ok(candidates.some(candidate => !candidate.includes("const rows") && candidate.includes("rows.push")));
  assert.ok(candidates.some(candidate => candidate.includes("const rows") && !candidate.includes("rows.push")));
  assert.ok(candidates.every(candidate => !candidate.includes("const rows: number[] = [\n    1,\n  ];")));
});

test("model then text shrinking retains strict/Node/witness and every oracle control gate", async context => {
  const directory = mkdtempSync(join(tmpdir(), "nts-generator-reducer-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  mkdirSync(join(directory, "src"));
  writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({
    extends: join(root, "tsconfig.fixtures.json"), include: ["src"],
  }));
  const expectation = "all: count array.get.checked in control == 0";
  const functions: FunctionSpec[] = [
    { name: "subject", role: "subject", counterpart: "control", parameters: ["number"], inputs: [[0], [1]] },
    { name: "control", role: "control", shortcut: expectation, parameters: ["number"], inputs: [[0], [1]] },
  ];
  interface Model { noise: boolean; sabotage: "none" | "type" | "node" | "route" | "control" | "shortcut" | "signature" | "backend" }
  function print(model: Model): string {
    return `// run: check
${model.sabotage === "shortcut" ? "" : `// expect-ir: ${expectation}`}
${model.noise ? "const noise: number = 999;" : ""}
const context: number[] = [1.5];
${model.sabotage === "type" ? 'const invalid: number = "not a number";' : ""}
${model.sabotage === "node" ? "let calls: number = 0;" : ""}
${["control", "signature", "backend"].includes(model.sabotage) ? `const ${model.sabotage}Change: number = 1;` : ""}
export function subject(n: number): number | undefined {
  const textOnlyNoise: number = 123;
  const xs: number[] = [10, 20, 30, 40];
  let i: number = 3;
  ${model.sabotage === "route" ? "" : "if (n > 0) i = 7;"}
  ${model.sabotage === "node" ? "return calls++;" : "return xs[i];"}
}
export function control(n: number): number | undefined {
  const xs: number[] = [10, 20, 30, 40];
  return xs[3];
}
`;
  }
  async function precheck(candidate: ReductionCandidate<Model>) {
    writeFileSync(join(directory, "src", "main.ts"), candidate.source);
    return precheckProgram(directory, functions);
  }
  function request(candidate: ReductionCandidate<Model>): OracleRequest {
    return { directory, source: candidate.source, cell: "bounds:merge", template: "index-range-join", functions, backends: ["c", "llvm", "jvm"] };
  }
  const phases: string[] = [];
  const oracle = {
    evaluate(req: OracleRequest): OracleResult {
      const failingBackend = req.source.includes("backendChange") ? "llvm" : "c";
      const reachesBug = req.source.includes("return xs[i];") && req.source.includes("i = 7;");
      return {
        version: 1,
        failure: reachesBug ? { kind: "wrong-answer", signature: req.source.includes("signatureChange") ? "different-bug" : "index-join", backends: [failingBackend] } : null,
        backends: req.backends.map(backend => ({
          backend, check: reachesBug && backend === failingBackend ? disagrees(req.functions.length) : agrees(req.functions.length),
          controls: [{ name: "control", check: req.source.includes("controlChange") ? disagrees() : agrees(),
            shortcuts: [{ expectation, status: req.source.includes("const context") ? "pass" : "fail",
              use: req.source.includes("return xs[3];") ? "present" : "missing" }] }],
        })),
      };
    },
  };
  const initial: Model = { noise: true, sabotage: "none" };
  const result = await reduceProgram<Model>({
    initial: { model: initial, source: print(initial) }, print, request, oracle,
    async precheck(candidate) { phases.push(candidate.phase); return precheck(candidate); },
    *modelCandidates(model: Model): Generator<Model> {
      for (const sabotage of ["type", "node", "route", "control", "shortcut", "signature", "backend"]) {
        if (sabotage === "type" || sabotage === "node" || sabotage === "route" || sabotage === "control"
          || sabotage === "shortcut" || sabotage === "signature" || sabotage === "backend") yield { ...model, sabotage };
      }
      if (model.noise) yield { ...model, noise: false };
    },
    maxCandidates: 100,
  });
  assert.equal(result.model.noise, false);
  assert.equal(result.model.sabotage, "none");
  assert.equal(result.textReduced, true);
  assert.ok(!result.source.includes("textOnlyNoise"));
  assert.ok(result.source.includes("const context"));
  assert.ok(result.source.includes("return xs[i];"));
  assert.ok(result.source.includes("return xs[3];"));
  assert.ok(result.source.includes(`// expect-ir: ${expectation}`));
  assert.equal(result.stats.modelAccepted, 1);
  assert.ok(result.stats.textAccepted > 0);
  assert.ok((result.stats.rejected["precheck:typecheck"] ?? 0) > 0);
  assert.ok((result.stats.rejected["precheck:nondeterministic"] ?? 0) > 0);
  assert.ok((result.stats.rejected["precheck:no-witness"] ?? 0) > 0);
  assert.ok((result.stats.rejected["changed-failure-signature"] ?? 0) > 0);
  assert.ok(Object.keys(result.stats.rejected).some(reason => reason.startsWith("control-does-not-agree:")));
  assert.ok(Object.keys(result.stats.rejected).some(reason => reason.startsWith("control-shortcut-not-proved:")));
  assert.ok(Object.keys(result.stats.rejected).some(reason => reason.startsWith("missing-shortcut:")));
  const textAt = phases.indexOf("text");
  assert.ok(textAt > 0);
  assert.ok(phases.slice(textAt).every(phase => phase === "text"));
  assert.equal((await precheck({ model: result.model, source: result.source, phase: "text" })).ok, true);
});
