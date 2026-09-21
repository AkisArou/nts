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
    // Widened 2026-09-21, once every refusal the shapes above produced was a
    // decision written down. An instrument whose walls are all documented has
    // stopped being an instrument, which is the same reason
    // `fuzz-expressions.mjs` needed this file in the first place.
    "objectFields", "objectMutated", "objectInArray", "destructured",
    "destructuredWithDefault", "closureOverLet", "closureInLoop", "closureCounter",
    "tryCatch", "tryFinally", "nestedFunction", "shadowed", "ternaryChain",
    "switchOnNumber", "labelledBreak", "optionalChain", "optionalChainTest", "nullishDefault",
    "templateBuild", "templateLength", "forOfArray", "forInObject", "spreadArray", "sortedArray",
    // Widened again 2026-09-21. The 42 shapes above never build a class, and
    // classes are most of what `runtime/node` is: fields, a constructor, an
    // accessor, a base and an override. Nor did anything exercise `do`/`while`
    // with a `continue`, a caught value's own content, or the string and table
    // operations a program spends its time in.
    "classField", "classAccessor", "classInherit", "classOverride", "classStatic",
    "classPrivate", "classCounter", "doWhile", "continueInLoop", "labelledContinue",
    "caughtValue", "throwCaught", "stringSlice", "stringSplit", "stringPad",
    "mapOps", "setOps", "arrayFold", "arrayFilterMap", "numberFormat",
    // 2026-09-22, with `Hierarchy::stored`: an object literal at a
    // method-signature interface, supplying the method with an environment in
    // each of its spellings, and two literals at one interface. At module
    // scope the captured name is reached by name and the method stays on the
    // table; in the function arm it is a real capture and becomes a field --
    // so one shape drives both representations against node.
    "literalAtInterface", "twoLiteralsAtOneInterface",
  ]);
  const xs = v("xs");
  const a = v("a");
  const s = v("s");
  const o = v("o");

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
      // The declared type follows the *read*. Drawing it separately put
      // `number` on a spelling that returns a string, and tsc rejected the
      // whole batch -- a case the fuzzer could not run rather than one it did.
      {
        const read = pick([s, `${s}.length`]);
        return tag({ stmts, read, type: read === s ? "string" : "number" });
      }
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
    case "objectFields":
      return tag({
        stmts: [`const ${o} = { a: ${num()}, b: ${num()} };`],
        read: pick([`${o}.a`, `${o}.a + ${o}.b`, `${o}.b * 2`]),
        type: "number",
      });
    case "objectMutated":
      return tag({
        stmts: [`const ${o} = { a: ${num()}, b: ${num()} };`, `${o}.a = ${num()};`, `${o}.b ${pick(["+=", "-="])} ${num()};`],
        read: pick([`${o}.a`, `${o}.b`, `${o}.a + ${o}.b`]),
        type: "number",
      });
    case "objectInArray":
      return tag({
        stmts: [`const ${xs} = [{ a: ${num()} }, { a: ${num()} }];`],
        read: pick([`${xs}[0].a`, `${xs}[1].a`, `${xs}.length`]),
        type: "number",
      });
    case "destructured":
      return tag({
        stmts: [`const ${o} = { a: ${num()}, b: ${num()} };`, `const { a: ${a}, b: ${s} } = ${o};`],
        read: pick([a, `${a} + ${s}`]),
        type: "number",
      });
    case "destructuredWithDefault":
      return tag({
        stmts: [`const ${xs}: number[] = [${num()}];`, `const [${a} = ${num()}, ${s} = ${num()}] = ${xs};`],
        read: pick([a, s, `${a} + ${s}`]),
        type: "number",
      });
    case "closureOverLet":
      return tag({
        stmts: [`let ${a} = ${num()};`, `const ${s} = (): number => ${a};`, `${a} = ${num()};`],
        read: `${s}()`,
        type: "number",
      });
    case "closureInLoop":
      return tag({
        stmts: [
          `const ${xs}: (() => number)[] = [];`,
          `for (let k = 0; k < ${int(2, 4)}; k++) { ${xs}.push((): number => k); }`,
        ],
        read: pick([`${xs}[0]()`, `${xs}[1]()`, `${xs}.length`]),
        type: "number",
      });
    case "closureCounter":
      return tag({
        stmts: [
          `let ${a} = 0;`,
          `const ${s} = (): number => { ${a} = ${a} + 1; return ${a}; };`,
          `${s}();`,
          `${s}();`,
        ],
        read: pick([a, `${s}()`]),
        type: "number",
      });
    case "tryCatch":
      return tag({
        stmts: [
          `let ${a} = ${num()};`,
          `try { if (${a} > -99) { throw new Error("x"); } ${a} = 1; } catch { ${a} = ${num()}; }`,
        ],
        read: a,
        type: "number",
      });
    case "tryFinally":
      return tag({
        stmts: [`let ${a} = ${num()};`, `try { ${a} = ${a} + 1; } finally { ${a} = ${a} * 2; }`],
        read: a,
        type: "number",
      });
    case "nestedFunction":
      return tag({
        stmts: [
          `function inner${"__TAG__"}(v: number): number { return v * 2 + ${num()}; }`,
          `const ${a} = inner${"__TAG__"}(${num()});`,
        ],
        read: a,
        type: "number",
      });
    case "shadowed":
      return tag({
        stmts: [`const ${a} = ${num()};`, `const ${s} = ((): number => { const ${a} = ${num()}; return ${a}; })();`],
        read: pick([a, s, `${a} + ${s}`]),
        type: "number",
      });
    case "ternaryChain":
      return tag({
        stmts: [`const ${a} = ${num()};`, `const ${s} = ${a} > 1 ? ${num()} : ${a} < 0 ? ${num()} : ${num()};`],
        read: s,
        type: "number",
      });
    case "switchOnNumber":
      return tag({
        stmts: [
          // Annotated, because an unannotated `const` is narrowed to its
          // literal type and every other `case` is then "not comparable".
          `const ${a}: number = ${int(0, 3)};`,
          `let ${s} = 0;`,
          `switch (${a}) { case 0: ${s} = ${num()}; break; case 1: ${s} = ${num()}; break; default: ${s} = ${num()}; }`,
        ],
        read: s,
        type: "number",
      });
    case "labelledBreak":
      return tag({
        stmts: [
          `let ${a} = 0;`,
          `outer${"__TAG__"}: for (let k = 0; k < 3; k++) { for (let j = 0; j < 3; j++) { if (j === 1) { continue outer${"__TAG__"}; } ${a} = ${a} + 1; } }`,
        ],
        read: a,
        type: "number",
      });
    case "optionalChain":
      return tag({
        stmts: [`const ${o}: { a?: number } = ${pick([`{ a: ${num()} }`, "{}"])};`],
        read: `${o}.a ?? ${num()}`,
        type: "number",
      });
    case "optionalChainTest":
      return tag({
        stmts: [`const ${o}: { a?: number } = ${pick([`{ a: ${num()} }`, "{}"])};`],
        read: `${o}.a === undefined`,
        type: "boolean",
      });
    case "nullishDefault":
      return tag({
        stmts: [`const ${o}: number | null = ${pick(["null", num()])};`, `const ${a} = ${o} ?? ${num()};`],
        read: a,
        type: "number",
      });
    case "templateBuild":
      return tag({
        stmts: [`const ${a} = ${num()};`, `const ${s} = \`v=\${${a}}!\`;`],
        read: s,
        type: "string",
      });
    case "templateLength":
      return tag({
        stmts: [`const ${a} = ${num()};`, `const ${s} = \`v=\${${a}}!\`;`],
        read: `${s}.length`,
        type: "number",
      });
    case "forOfArray":
      return tag({
        stmts: [
          `const ${xs}: number[] = [${num()}, ${num()}, ${num()}];`,
          `let ${a} = 0;`,
          `for (const v of ${xs}) { ${a} = ${a} + v; }`,
        ],
        read: a,
        type: "number",
      });
    case "forInObject":
      return tag({
        stmts: [
          `const ${o}: Record<string, number> = { a: ${num()}, b: ${num()} };`,
          `let ${a} = 0;`,
          `for (const k in ${o}) { ${a} = ${a} + ${o}[k]; }`,
        ],
        read: a,
        type: "number",
      });
    case "spreadArray":
      return tag({
        stmts: [`const ${xs}: number[] = [${num()}, ${num()}];`, `const ${s}: number[] = [...${xs}, ${num()}];`],
        read: pick([`${s}.length`, `${s}[2]`, `${s}[0]`]),
        type: "number",
      });
    case "sortedArray":
      return tag({
        stmts: [`const ${xs}: number[] = [${num()}, ${num()}, ${num()}];`, `const ${s} = ${xs}.slice().sort((p: number, q: number): number => p - q);`],
        read: pick([`${s}[0]`, `${s}.length`]),
        type: "number",
      });
    case "classField":
      return tag({
        stmts: [`class K${"__TAG__"} { a = ${num()}; b = ${num()}; }`, `const ${o} = new K${"__TAG__"}();`],
        read: pick([`${o}.a`, `${o}.a + ${o}.b`]),
        type: "number",
      });
    case "classAccessor":
      return tag({
        stmts: [
          `class K${"__TAG__"} { #v = ${num()}; get v(): number { return this.#v; } set v(n: number) { this.#v = n; } }`,
          `const ${o} = new K${"__TAG__"}();`,
          `${o}.v = ${num()};`,
        ],
        read: `${o}.v`,
        type: "number",
      });
    case "classInherit":
      return tag({
        stmts: [
          `class B${"__TAG__"} { a = ${num()}; base(): number { return this.a; } }`,
          `class K${"__TAG__"} extends B${"__TAG__"} { b = ${num()}; }`,
          `const ${o} = new K${"__TAG__"}();`,
        ],
        read: pick([`${o}.base()`, `${o}.a + ${o}.b`]),
        type: "number",
      });
    case "classOverride":
      return tag({
        stmts: [
          `class B${"__TAG__"} { go(): number { return ${num()}; } }`,
          `class K${"__TAG__"} extends B${"__TAG__"} { override go(): number { return super.go() + ${num()}; } }`,
          `const ${o}: B${"__TAG__"} = new K${"__TAG__"}();`,
        ],
        read: `${o}.go()`,
        type: "number",
      });
    case "classStatic":
      return tag({
        stmts: [`class K${"__TAG__"} { static n = ${num()}; static twice(): number { return K${"__TAG__"}.n * 2; } }`],
        read: pick([`K${"__TAG__"}.n`, `K${"__TAG__"}.twice()`]),
        type: "number",
      });
    case "classPrivate":
      return tag({
        stmts: [
          `class K${"__TAG__"} { #h = ${num()}; bump(): number { this.#h = this.#h + 1; return this.#h; } }`,
          `const ${o} = new K${"__TAG__"}();`,
          `${o}.bump();`,
        ],
        read: `${o}.bump()`,
        type: "number",
      });
    case "classCounter":
      return tag({
        stmts: [
          `class K${"__TAG__"} { n = 0; add(v: number): number { this.n = this.n + v; return this.n; } }`,
          `const ${o} = new K${"__TAG__"}();`,
          `${o}.add(${num()});`,
        ],
        read: `${o}.add(${num()})`,
        type: "number",
      });
    case "doWhile":
      return tag({
        stmts: [`let ${a} = 0;`, `let ${s} = 0;`, `do { ${s} = ${s} + ${a}; ${a} = ${a} + 1; } while (${a} < ${int(1, 4)});`],
        read: s,
        type: "number",
      });
    case "continueInLoop":
      return tag({
        stmts: [`let ${a} = 0;`, `for (let k = 0; k < 6; k++) { if (k % 2 === 0) { continue; } ${a} = ${a} + k; }`],
        read: a,
        type: "number",
      });
    case "labelledContinue":
      return tag({
        stmts: [
          `let ${a} = 0;`,
          `outer${"__TAG__"}: for (let k = 0; k < 3; k++) { for (let j = 0; j < 3; j++) { if (j > k) { continue outer${"__TAG__"}; } ${a} = ${a} + 1; } }`,
        ],
        read: a,
        type: "number",
      });
    case "caughtValue":
      return tag({
        stmts: [
          `let ${s} = "";`,
          `try { throw new Error(${word()}); } catch (e) { ${s} = e instanceof Error ? e.message : "?"; }`,
        ],
        read: `${s}.length`,
        type: "number",
      });
    case "throwCaught":
      return tag({
        stmts: [
          `let ${a} = 0;`,
          `try { if (${num()} >= 0) { throw new RangeError("r"); } ${a} = 1; } catch { ${a} = 2; } finally { ${a} = ${a} + 10; }`,
        ],
        read: a,
        type: "number",
      });
    case "stringSlice":
      return tag({
        stmts: [`const ${s} = ${word()} + "abcdef";`],
        read: pick([`${s}.slice(${int(0, 3)}).length`, `${s}.slice(${int(0, 2)}, ${int(3, 6)}).length`, `${s}.indexOf("c")`]),
        type: "number",
      });
    case "stringSplit":
      return tag({
        stmts: [`const ${s} = "a,b,,c";`, `const ${xs} = ${s}.split(",");`],
        read: pick([`${xs}.length`, `${xs}[1].length`, `${xs}.join("-").length`]),
        type: "number",
      });
    case "stringPad":
      return tag({
        stmts: [`const ${s} = ${word()};`],
        read: pick([`${s}.padStart(${int(1, 6)}, "x").length`, `${s}.trim().length`, `${s}.repeat(${int(0, 3)}).length`]),
        type: "number",
      });
    case "mapOps":
      return tag({
        stmts: [
          `const ${o} = new Map<string, number>();`,
          `${o}.set("a", ${num()});`,
          `${o}.set("b", ${num()});`,
        ],
        read: pick([`${o}.size`, `${o}.get("a") ?? -1`, `${o}.has("c") ? 1 : 0`]),
        type: "number",
      });
    case "setOps":
      return tag({
        stmts: [`const ${o} = new Set<number>();`, `${o}.add(${num()});`, `${o}.add(${num()});`],
        read: pick([`${o}.size`, `${o}.has(0) ? 1 : 0`]),
        type: "number",
      });
    case "arrayFold":
      return tag({
        stmts: [`const ${xs}: number[] = [${num()}, ${num()}, ${num()}];`],
        read: pick([
          `${xs}.reduce((p: number, q: number): number => p + q, 0)`,
          `${xs}.filter((v: number): boolean => v > 0).length`,
          `${xs}.map((v: number): number => v * 2)[1]`,
        ]),
        type: "number",
      });
    case "arrayFilterMap":
      return tag({
        stmts: [
          `const ${xs}: number[] = [${num()}, ${num()}, ${num()}, ${num()}];`,
          `const ${s} = ${xs}.filter((v: number): boolean => v !== 0).map((v: number): number => v + 1);`,
        ],
        read: pick([`${s}.length`, `${s}.reduce((p: number, q: number): number => p + q, 0)`]),
        type: "number",
      });
    case "literalAtInterface": {
      const spelling = pick([
        `{ read(): number { return ${a} + 1; } }`,
        `{ read: (): number => ${a} * 2 }`,
        `{ read: function (): number { return ${a} - 1; } }`,
      ]);
      return tag({
        stmts: [
          `interface R__TAG__ { read(): number }`,
          `const ${a} = ${num()};`,
          `const ${o}: R__TAG__ = ${spelling};`,
        ],
        read: `${o}.read()`,
        type: "number",
      });
    }
    case "twoLiteralsAtOneInterface":
      return tag({
        stmts: [
          `interface P__TAG__ { left(): number }`,
          `const ${a} = ${num()};`,
          `const ${o}: P__TAG__ = { left(): number { return ${a}; } };`,
          `const ${s}: P__TAG__ = { left(): number { return 1; } };`,
        ],
        read: `${o}.left() + ${s}.left()`,
        type: "number",
      });
    case "numberFormat":
      return tag({
        stmts: [`const ${a} = ${num()};`],
        read: pick([`${a}.toFixed(2).length`, `${a}.toString(16).length`, `Number.isInteger(${a}) ? 1 : 0`]),
        type: "number",
      });
    default:
      return tag({
        stmts: [`const ${s} = ${word()};`, `const ${a} = ${s}.length;`],
        read: a,
        type: "number",
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
    .replaceAll("__s", `s${suffix}`)
    .replaceAll("__o", `o${suffix}`)
    // Labels and nested function names need the suffix too, and are spelled
    // with their own marker so they cannot collide with a variable.
    .replaceAll("__TAG__", `${suffix}`);
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
const rejected = new Map();
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
          // **Named, because a case tsc rejects is a case this did not run.**
          // A generator that quietly produces invalid TypeScript shrinks its
          // own denominator, and the headline count cannot show that.
          totals.typescript += 1;
          note(rejected, `${cases[0].shape}: ${verdict.detail}`);
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
if (rejected.size > 0) {
  console.log("  rejected by tsc (cases this could not run):");
  for (const [message, count] of [...rejected].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    console.log(`    ${String(count).padStart(4)}  ${message}`);
  }
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
