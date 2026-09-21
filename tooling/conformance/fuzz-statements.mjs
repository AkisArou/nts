// Our compiled *statement* semantics against node's.
//
//   node tooling/conformance/fuzz-statements.mjs [cases] [seed]
//
// # Why this exists beside `fuzz-expressions.mjs`
//
// That fuzzer generates expressions: no bindings, no mutation, no statements.
// It ran 1,600 generated expressions across eight fresh seeds on 2026-09-21 and
// reported `0 differ, 0 refused` --- the grammar had been widened until it only
// produced constructs the compiler already handles, which is the subset someone
// already thought about.
//
// Every defect found by hand that week lived one level out, in *statements*:
//
//   * `const xs = []; xs[0] = 7; xs[1] = 8; xs[0] + xs[1]` refused, because the
//     walk deciding whether the writes were a dense prefix took the `+` for a
//     compound assignment;
//   * a `var` loop head read as the global's zero from inside any function;
//   * `xs[1] = 2` on a length-1 array aborted with no diagnostic;
//   * `const xs = []; xs.push("a")` emitted a call against a `double`.
//
// None of those is an expression. All of them are a declaration, some writes,
// and a read.
//
// # Both placements, always
//
// Each generated body is emitted **twice**: once at module scope and once
// inside a function, with the same statements and the same read. That pairing
// is the single highest-yield instrument in this repository --- the two are
// decided by different code (`collect_module_scope` / `settled_global_type` for
// one, `lower_variable_statement` / `bind_pattern` for the other), and they
// have disagreed repeatedly.
//
// So a case can fail three ways: module scope differs from node, the function
// differs from node, or the two differ from each other while both compile. The
// third is reported even when node agrees with one of them, because two
// spellings of one program answering differently is a defect whichever one is
// right.
//
// # What a refusal means here
//
// The same as next door: not a failure. A refused batch is bisected, the
// refusing case is attributed to its message and dropped, and everything beside
// it is still measured. `refused` is a map of where the generator wandered past
// what the compiler accepts, and it is interesting output rather than noise.

import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  HARNESS,
  PRINTER,
  assertion,
  compileAndRun,
  pickers,
  runOracle,
  scratch,
} from "./fuzz-runtime.mjs";

const CASES = Number(process.argv[2] ?? 200);
const SEED = Number(process.argv[3] ?? 1);
const BATCH = 20;

const { next, pick, int } = pickers(SEED);

const num = () =>
  pick(["0", "1", "2", "3", "7", "-1", "0.5", "-0", "1e3", "255"]);
const word = () => JSON.stringify(pick(["", "a", "ab", "abc", "hi", "0", " "]));

/**
 * One generated body: statements, a read, and the read's type.
 *
 * Names carry the case index so that many bodies can share one module without
 * colliding, which is what lets a batch pay for one `cc` instead of twenty.
 */
function body(i) {
  // `shape` rides along so a refusal names the construct that produced it;
  // a message alone ranks texts rather than causes.
  // Placeholders, substituted per placement. A textual rename of *generated*
  // code is fragile by construction: the first version rewrote `(\b\w+)55\b`
  // for case 55 and turned the literal `255` into `255i`, which broke the
  // oracle for a whole batch. A `__`-prefixed token cannot occur inside a
  // number, a string body, or another name.
  const v = (base) => `__${base}`;
  const shape = pick([
    "fill", "fillOutOfOrder", "fillSparse", "fillThenCompound", "fillThenLogical",
    "push", "pushThenIndex", "annotatedFill", "scalarMutate", "stringBuild",
    "loopFill", "loopPush", "whileFill", "nestedRead", "varRedeclared",
    "conditionalWrite", "lengthAfterWrites", "reassignedArray", "strings",
  ]);
  const xs = v("xs");
  const a = v("a");
  const s = v("s");

  const tag = (b) => ({ ...b, shape });
  switch (shape) {
    case "fill": {
      const n = int(1, 3);
      const stmts = [`const ${xs} = [];`];
      for (let k = 0; k < n; k++) stmts.push(`${xs}[${k}] = ${num()};`);
      const read = pick([`${xs}[0]`, `${xs}.length`, `${xs}[0] + ${xs}[${n - 1}]`, `${xs}[0] * 2`]);
      return tag({ stmts, read, type: "number" });
    }
    case "fillOutOfOrder":
      return tag({
        stmts: [`const ${xs} = [];`, `${xs}[1] = ${num()};`, `${xs}[0] = ${num()};`],
        read: `${xs}.length`,
        type: "number",
      });
    case "fillSparse":
      return tag({
        stmts: [`const ${xs} = [];`, `${xs}[0] = ${num()};`, `${xs}[${int(2, 4)}] = ${num()};`],
        read: `${xs}.length`,
        type: "number",
      });
    case "fillThenCompound":
      return tag({
        stmts: [
          `const ${xs} = [];`,
          `${xs}[0] = ${num()};`,
          `${xs}[1] = ${num()};`,
          `${xs}[0] ${pick(["+=", "-=", "*="])} ${num()};`,
        ],
        read: `${xs}[0]`,
        type: "number",
      });
    case "fillThenLogical":
      return tag({
        stmts: [`const ${xs} = [];`, `${xs}[0] = ${num()};`, `${xs}[0] ${pick(["??=", "||=", "&&="])} ${num()};`],
        read: `${xs}[0]`,
        type: "number",
      });
    case "push": {
      const n = int(1, 3);
      const stmts = [`const ${xs} = [];`];
      for (let k = 0; k < n; k++) stmts.push(`${xs}.push(${num()});`);
      return tag({ stmts, read: pick([`${xs}.length`, `${xs}[0]`]), type: "number" });
    }
    case "pushThenIndex":
      return tag({
        stmts: [`const ${xs} = [];`, `${xs}.push(${num()});`, `${xs}[1] = ${num()};`],
        read: pick([`${xs}.length`, `${xs}[1]`]),
        type: "number",
      });
    case "annotatedFill":
      return tag({
        stmts: [`const ${xs}: number[] = [];`, `${xs}[0] = ${num()};`, `${xs}[1] = ${num()};`],
        read: pick([`${xs}[1]`, `${xs}.length`, `${xs}[0] + ${xs}[1]`]),
        type: "number",
      });
    case "scalarMutate": {
      const stmts = [`let ${a} = ${num()};`];
      const n = int(1, 3);
      for (let k = 0; k < n; k++) {
        stmts.push(pick([`${a} ${pick(["+=", "-=", "*="])} ${num()};`, `${a} = ${a} + ${num()};`]));
      }
      return tag({ stmts, read: a, type: "number" });
    }
    case "stringBuild": {
      const stmts = [`let ${s} = ${word()};`];
      const n = int(1, 3);
      for (let k = 0; k < n; k++) stmts.push(`${s} += ${word()};`);
      return tag({ stmts, read: pick([s, `${s}.length`]), type: pick(["string", "number"]) === "number" ? "number" : "string" });
    }
    case "loopFill":
      return tag({
        stmts: [
          `const ${xs}: number[] = [];`,
          `for (let k = 0; k < ${int(1, 4)}; k++) { ${xs}[k] = k * ${num()}; }`,
        ],
        read: pick([`${xs}.length`, `${xs}[0]`]),
        type: "number",
      });
    case "loopPush":
      return tag({
        stmts: [
          `const ${xs}: number[] = [];`,
          `for (let k = 0; k < ${int(1, 4)}; k++) { ${xs}.push(k); }`,
        ],
        read: pick([`${xs}.length`, `${xs}[0]`]),
        type: "number",
      });
    case "whileFill":
      return tag({
        stmts: [
          `const ${xs}: number[] = [];`,
          `let ${a} = 0;`,
          `while (${a} < ${int(1, 3)}) { ${xs}.push(${a}); ${a} = ${a} + 1; }`,
        ],
        read: pick([`${xs}.length`, a]),
        type: "number",
      });
    case "nestedRead":
      return tag({
        stmts: [`const ${xs}: number[] = [${num()}, ${num()}, ${num()}];`],
        read: pick([`${xs}[${xs}.length - 1]`, `${xs}[0] + ${xs}[1] + ${xs}[2]`]),
        type: "number",
      });
    case "varRedeclared":
      return tag({
        stmts: [`var ${a} = ${num()};`, `${a} = ${num()};`, `var ${a} = ${num()};`],
        read: a,
        type: "number",
      });
    case "conditionalWrite":
      return tag({
        stmts: [
          `const ${xs}: number[] = [];`,
          `${xs}[0] = ${num()};`,
          `if (${xs}[0] > 0) { ${xs}[1] = ${num()}; } else { ${xs}[1] = ${num()}; }`,
        ],
        read: pick([`${xs}.length`, `${xs}[1]`]),
        type: "number",
      });
    case "lengthAfterWrites": {
      const n = int(1, 4);
      const stmts = [`const ${xs}: number[] = [];`];
      for (let k = 0; k < n; k++) stmts.push(`${xs}[${k}] = ${num()};`);
      return tag({ stmts, read: `${xs}.length`, type: "number" });
    }
    case "reassignedArray":
      return tag({
        stmts: [
          `let ${xs}: number[] = [${num()}];`,
          `${xs} = [${num()}, ${num()}];`,
        ],
        read: pick([`${xs}.length`, `${xs}[1]`]),
        type: "number",
      });
    default:
      return tag({
        stmts: [`const ${s} = ${word()};`, `const ${a} = ${s}.length;`],
        read: pick([a, `${s}`]),
        type: pick(["number", "string"]),
      });
  }
}

/**
 * The two placements of one body.
 *
 * The module arm runs the statements where they are written; the function arm
 * puts the identical statements in a body and returns the same read. Names are
 * distinct between the arms so both can live in one program.
 */
/** Substitute the placeholder names for one placement's suffix. */
function render(text, suffix) {
  return text
    .replaceAll("__xs", `xs${suffix}`)
    .replaceAll("__a", `a${suffix}`)
    .replaceAll("__s", `s${suffix}`);
}

function placements(i) {
  const b = body(i);
  const moduleStmts = b.stmts.map((s) => render(s, `${i}`));
  const moduleRead = render(b.read, `${i}`);
  const fnName = `fn${i}`;
  const inner = b.stmts.map((s) => render(s, `${i}i`));
  const innerRead = render(b.read, `${i}i`);
  const fn = `function ${fnName}(): ${b.type} {\n  ${inner.join("\n  ")}\n  return ${innerRead};\n}`;
  return {
    shape: b.shape,
    prelude: [...moduleStmts, fn].join("\n"),
    module: { code: moduleRead, label: `m${i}` },
    fn: { code: `${fnName}()`, label: `f${i}` },
  };
}

function oracleSource(cases) {
  const lines = [];
  for (const c of cases) {
    lines.push(c.prelude);
    lines.push(`try { print("${c.module.label}", ${c.module.code}); } catch { print("${c.module.label}", undefined); }`);
    lines.push(`try { print("${c.fn.label}", ${c.fn.code}); } catch { print("${c.fn.label}", undefined); }`);
  }
  return `${PRINTER.replace("function print(i, v)", "function print(_i, v)")}
${lines.join("\n")}
console.log(JSON.stringify(out));
`;
}

function programSource(cases, expected) {
  const parts = [HARNESS];
  let at = 0;
  for (const c of cases) {
    const wantModule = expected[at++];
    const wantFn = expected[at++];
    if (wantModule === null && wantFn === null) continue;
    parts.push(c.prelude);
    const m = assertion(c.module.code, wantModule, c.module.label);
    const f = assertion(c.fn.code, wantFn, c.fn.label);
    if (m) parts.push(m);
    if (f) parts.push(f);
  }
  return `${parts.join("\n")}\n`;
}

const dir = scratch("stmt");
const totals = { agree: 0, differ: 0, refused: 0, typescript: 0, panic: 0, other: 0 };
const refusals = new Map();
const found = [];
let armsDisagree = 0;

function note(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Bisect a group so that one refusal does not discard the rest. */
function measure(cases, expected, depth = 0) {
  if (cases.length === 0) return;
  const source = programSource(cases, expected);
  const verdict = compileAndRun(join(dir, `b${depth}`), source);
  switch (verdict.kind) {
    case "agree":
      totals.agree += cases.length;
      return;
    case "differ":
      if (cases.length === 1) {
        totals.differ += 1;
        found.push({ cases, expected, detail: verdict.detail });
        return;
      }
      break;
    case "refused":
    case "declined":
    case "invalid-hir":
    case "typescript":
    case "panic":
    case "cc-failed":
      if (cases.length === 1) {
        if (verdict.kind === "refused" || verdict.kind === "declined") {
          totals.refused += 1;
          note(refusals, `${cases[0].shape}: ${verdict.detail}`);
        } else if (verdict.kind === "typescript") {
          totals.typescript += 1;
        } else if (verdict.kind === "panic") {
          totals.panic += 1;
          found.push({ cases, expected, detail: `PANIC ${verdict.detail}` });
        } else {
          totals.other += 1;
          found.push({ cases, expected, detail: `${verdict.kind} ${verdict.detail}` });
        }
        return;
      }
      break;
    default:
      totals.other += 1;
      return;
  }
  const half = Math.floor(cases.length / 2);
  measure(cases.slice(0, half), expected.slice(0, half * 2), depth + 1);
  measure(cases.slice(half), expected.slice(half * 2), depth + 1);
}

let generated = 0;
while (generated < CASES) {
  const size = Math.min(BATCH, CASES - generated);
  const cases = [];
  for (let k = 0; k < size; k++) cases.push(placements(generated + k));
  generated += size;

  const answers = runOracle(dir, oracleSource(cases));
  if (!answers) {
    totals.other += size;
    continue;
  }
  // **The two arms of one body must agree with each other**, and node is the
  // one running both. A pair that differs here is a generator bug or a real
  // asymmetry in the source program, and either way the case is not a fair
  // test of the compiler -- so it is reported and dropped rather than asserted.
  for (let k = 0; k < cases.length; k++) {
    if (answers[k * 2] !== null && answers[k * 2] !== answers[k * 2 + 1]) {
      armsDisagree += 1;
      answers[k * 2] = null;
      answers[k * 2 + 1] = null;
    }
  }
  measure(cases, answers);
}

rmSync(dir, { recursive: true, force: true });

const label = `${CASES} case(s), seed ${SEED}`;
console.log(
  `${label}: ${totals.agree} agree, ${totals.differ} differ, ${totals.refused} refused, ` +
    `${totals.typescript} rejected by tsc, ${totals.other + totals.panic} unusable`,
);
if (armsDisagree > 0) {
  console.log(`  ${armsDisagree} generated pair(s) node itself answered differently; dropped`);
}
if (refusals.size > 0) {
  console.log("  refusals:");
  for (const [message, count] of [...refusals].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`    ${String(count).padStart(4)}  ${message}`);
  }
}
for (const f of found) {
  console.log(`  FOUND ${f.detail}`);
  for (const c of f.cases) {
    console.log(`    ${c.prelude.replace(/\n/g, "\n    ")}`);
    console.log(`    module: ${c.module.code}   fn: ${c.fn.code}`);
  }
}
process.exit(found.length > 0 ? 1 : 0);
