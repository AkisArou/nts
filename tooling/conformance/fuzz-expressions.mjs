// Our compiled expression semantics against node's, over random expressions.
//
//   node tooling/conformance/fuzz-expressions.mjs [cases] [seed]
//
// # Why this exists
//
// The two fuzzers beside it -- `fuzz-deep-equal` and `fuzz-timer-order` -- test
// *runtime* behaviours. Nothing generates programs to test the thing this
// compiler actually is: an expression, lowered, emitted as C, and run.
//
// That matters because of what the other instruments cannot see. The test262
// census ranks **refusals**, so a construct that compiles and returns the wrong
// number is invisible to it -- it is a `strict-pass` that happens to fail an
// assertion, or worse, one that passes anyway. The gate compares `examples/`,
// which are programs a person thought to write. On 2026-09-20 five wrong
// answers were found in one night by hand-writing ten-line probes, one area at
// a time: object spread dropping a getter, six enumerations dropping one, a
// `var` loop head reading as zero from any function, a literal answering a
// slot's zero, and `Object.keys` of a class answering `[]`. Each took a guess
// about *where* to look.
//
// This removes the guess from one axis of it.
//
// # The oracle, and why it is the exit status
//
// `console.log` does not lower, so a compiled program cannot print its answer.
// What it can do is **throw**, which is what `tooling/sweep/probe.sh` already
// uses: node evaluates each expression and its value is baked into the emitted
// program as `assert.sameValue(expr, <literal>)`. Agreement is exit 0.
//
// Each assertion carries its own index as the message, so a failure names
// itself -- `nts: uncaught Test262Error: #37` -- and no bisection is needed to
// find which of forty expressions disagreed. Only the first failure in a batch
// is reported, which is why a disagreement re-runs that one expression alone
// before it is printed: an isolated repro is what a person needs, and a batch
// is only a way to pay for one `cc` invocation instead of forty.
//
// # What a refusal means here
//
// A refused batch is **not a failure** and is not counted as one. A generator
// that only produced constructs known to lower would be testing the subset
// someone already thought about, which is the same blindness this exists to
// remove. So refusals are counted, their messages are reported, and the batch
// is skipped -- the interesting output is `differ`, and `refused` is a map of
// where the generator wandered past what the compiler accepts.
//
// # Determinism
//
// Seeded, and the seed is printed. A fuzzer whose failures cannot be reproduced
// is a fuzzer nobody acts on.

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

const CASES = Number(process.argv[2] ?? 400);
const SEED = Number(process.argv[3] ?? 1);
const BATCH = 40;

const { next, pick, int } = pickers(SEED);

/**
 * A number literal that is worth generating.
 *
 * Weighted towards the values that break things rather than uniformly over the
 * doubles: zero, the signed zero, the integer boundaries, and a fraction whose
 * decimal expansion is not exact.
 */
function numberLiteral() {
  return pick([
    "0",
    "-0",
    "1",
    "-1",
    "2",
    "3",
    "7",
    "10",
    "0.5",
    "0.1",
    "1.5",
    "-2.5",
    "100",
    "2147483647",
    "-2147483648",
    "4294967295",
    "9007199254740991",
    String(int(-50, 50)),
  ]);
}

const WORDS = ["", "a", "ab", "abc", "hello", "x y", "0", "10", " pad ", "ABC"];
const stringLiteral = () => JSON.stringify(pick(WORDS));

/** `depth` shrinks towards 0, which is what keeps an expression finite. */
function numberExpr(depth) {
  if (depth <= 0) return numberLiteral();
  const n = () => numberExpr(depth - 1);
  const s = () => stringExpr(depth - 1);
  return pick([
    () => numberLiteral(),
    () => `(${n()} + ${n()})`,
    () => `(${n()} - ${n()})`,
    () => `(${n()} * ${n()})`,
    () => `(${n()} / ${n()})`,
    () => `(${n()} % ${n()})`,
    // `-1 ** 2` is a SyntaxError in JavaScript --- a unary minus directly
    // before `**` must be parenthesised --- and the generator produces `-1`
    // as a literal, so the base is wrapped rather than trusted.
    () => `((${n()}) ** ${pick(["2", "3", "0"])})`,
    () => `(-(${n()}))`,
    () => `(${n()} | 0)`,
    () => `(${n()} & ${n()})`,
    () => `(${n()} ^ ${n()})`,
    () => `(${n()} << ${int(0, 5)})`,
    () => `(${n()} >> ${int(0, 5)})`,
    () => `(${n()} >>> ${int(0, 5)})`,
    () => `(~(${n()}))`,
    () => `Math.abs(${n()})`,
    () => `Math.floor(${n()})`,
    () => `Math.ceil(${n()})`,
    () => `Math.round(${n()})`,
    () => `Math.trunc(${n()})`,
    () => `Math.sign(${n()})`,
    () => `Math.min(${n()}, ${n()})`,
    () => `Math.max(${n()}, ${n()})`,
    () => `${s()}.length`,
    () => `${s()}.indexOf(${stringLiteral()})`,
    () => `${arrayExpr(depth - 1)}.length`,
    () => `(${boolExpr(depth - 1)} ? ${n()} : ${n()})`,
    () => `Number(${s()})`,
    // A member read off a literal, which is the seam six consumers were wrong
    // about on 2026-09-20. A getter here is a *call* that looks like a load.
    () => `({ k: ${n()} }).k`,
    () => `({ get k(): number { return ${n()}; } }).k`,
    () => `({ a: ${n()}, b: ${n()} }).b`,
    // A fixed three-element literal, indexed in range: an out-of-range read is
    // a known wrong answer (`[] as number[]` then `[0]` gives 0 where node
    // gives `undefined`) and generating it would report noise, not news.
    () => `[${n()}, ${n()}, ${n()}][${int(0, 2)}]`,
    // **No synthetic `??` over a number.** `2 ?? 0` is TS2869, and widening
    // with `as number | null` does not help: TypeScript sees through the
    // assertion on a literal and still calls the right operand unreachable.
    // It was every one of the nine rejections in a 240-case run.
    //
    // `??` is still covered, and genuinely: `codePointAt` returns
    // `number | undefined`, so the arm below is a real nullish test rather than
    // one the checker can fold away --- and it is the arm that found
    // `?? (-1 >>> 4)` answering 0.
    // Coercion corners: the places a compiled backend can quietly differ from a
    // double-based interpreter.
    () => `parseInt(${s()}, ${pick(["10", "16", "2"])})`,
    () => `parseFloat(${s()})`,
    // **No implementation-approximated `Math`.** `cbrt`, `hypot`, `log2`,
    // `pow` with a fractional exponent and their neighbours are the ones the
    // specification explicitly does *not* require to be exact, and glibc and
    // V8 differ in the last few bits. This oracle is `assert.sameValue`, so it
    // reported `Math.cbrt(2)` as a disagreement on its first run with them in.
    //
    // `nts check` is the instrument that handles these: it carries a ULP
    // tolerance and says so --- "13 case(s) matched only to within 4 ULP, in
    // functions whose result the specification leaves implementation-
    // approximated". Teaching this one the same tolerance would make it a
    // second copy of that judgement, so it generates the exact ones instead.
    () => `Math.fround(${n()})`,
    () => `Number.parseFloat(String(${n()}))`,
    () => `${s()}.charCodeAt(${int(0, 4)})`,
    // **Parenthesised, and with a generated right operand.**
    //
    // Unparenthesised it composes badly: `??` binds looser than `^` and `>>>`,
    // so `(x ^ s.codePointAt(0) ?? -1)` puts a never-nullish expression on the
    // left and TypeScript rejects it as TS2869 --- the last of the generator's
    // waste.
    //
    // The right operand is generated rather than `-1`, because that is what
    // matters: `?? (-1 >>> 4)` answers 0 where node says 268435455, and
    // `?? -1`, `?? (5 | 0)` and `?? 268435455` are all correct. A fixed right
    // operand would never have found it.
    () => `(${s()}.codePointAt(${int(0, 3)}) ?? ${numberExpr(0)})`,
    () => `(${s()}.codePointAt(${int(0, 3)}) ?? (${numberExpr(0)} >>> ${int(0, 5)}))`,
    () => `(Number.MAX_SAFE_INTEGER - ${int(0, 3)})`,
    () => `(${n()} + ${n()} * ${n()})`,
    () => `${arrayExpr(depth - 1)}.reduce((a: number, b: number): number => a + b, 0)`,
    () => `${arrayExpr(depth - 1)}.indexOf(${numberExpr(0)})`,
    () => `${s()}.lastIndexOf(${stringLiteral()})`,
  ])();
}

function stringExpr(depth) {
  if (depth <= 0) return stringLiteral();
  const s = () => stringExpr(depth - 1);
  const n = () => numberExpr(depth - 1);
  return pick([
    () => stringLiteral(),
    () => `(${s()} + ${s()})`,
    () => `\`v=\${${n()}}\``,
    () => `${s()}.toUpperCase()`,
    () => `${s()}.toLowerCase()`,
    () => `${s()}.trim()`,
    () => `${s()}.slice(${int(-3, 3)})`,
    () => `${s()}.slice(${int(-3, 3)}, ${int(-3, 4)})`,
    () => `${s()}.substring(${int(0, 3)}, ${int(0, 4)})`,
    () => `${s()}.charAt(${int(0, 4)})`,
    () => `${s()}.repeat(${int(0, 3)})`,
    () => `${s()}.padStart(${int(0, 5)}, ${stringLiteral() || '"-"'})`,
    () => `${s()}.padEnd(${int(0, 5)}, "-")`,
    () => `${s()}.replace(${stringLiteral()}, ${stringLiteral()})`,
    () => `${s()}.concat(${s()})`,
    () => `String(${n()})`,
    () => `${arrayExpr(depth - 1)}.join(${stringLiteral()})`,
    () => `(${boolExpr(depth - 1)} ? ${s()} : ${s()})`,
    () => `({ k: ${s()} }).k`,
    () => `({ get k(): string { return ${s()}; } }).k`,
    () => `[${s()}, ${s()}][${int(0, 1)}]`,
    () => `(() => ${s()})()`,
    // `+` with a number on one side is ToString, which is not `String(x)` for
    // every value --- `-0`, `1e21` and `1e-7` each have their own spelling.
    () => `(${s()} + ${n()})`,
    () => `(${n()} + ${s()})`,
    () => `${s()}.split(${stringLiteral()}).join(${stringLiteral()})`,
    () => `${arrayExpr(depth - 1)}.map((v: number): string => String(v)).join("")`,
    () => `(${s()}.at(${int(-3, 3)}) ?? "!")`,
    () => `String.fromCharCode(${int(65, 90)}, ${int(97, 122)})`,
    () => `${s()}.replaceAll(${stringLiteral()}, ${stringLiteral()})`,
    () => `${s()}.split("").reverse().join("")`,
  ])();
}

function boolExpr(depth) {
  if (depth <= 0) return pick(["true", "false"]);
  const n = () => numberExpr(depth - 1);
  const s = () => stringExpr(depth - 1);
  const b = () => boolExpr(depth - 1);
  return pick([
    () => pick(["true", "false"]),
    () => `(${n()} < ${n()})`,
    () => `(${n()} <= ${n()})`,
    () => `(${n()} > ${n()})`,
    () => `(${n()} >= ${n()})`,
    // **Widened to the base type.** Two inline literals give TypeScript literal
    // types, and comparing disjoint ones is TS2367 --- seven of ten rejections
    // in a 160-case run. The comparison this is testing is the *machine* one,
    // which the cast does not change.
    () => `((${n()}) as number === (${n()}) as number)`,
    () => `((${n()}) as number !== (${n()}) as number)`,
    () => `((${s()}) as string === (${s()}) as string)`,
    () => `(${s()} < ${s()})`,
    () => `(${b()} && ${b()})`,
    () => `(${b()} || ${b()})`,
    () => `(!${b()})`,
    () => `${s()}.includes(${stringLiteral()})`,
    () => `${s()}.startsWith(${stringLiteral()})`,
    () => `${s()}.endsWith(${stringLiteral()})`,
    () => `Number.isInteger(${n()})`,
    () => `Number.isFinite(${n()})`,
    () => `Number.isNaN(${n()})`,
    () => `({ k: ${b()} }).k`,
    () => `${arrayExpr(depth - 1)}.includes(${numberExpr(0)})`,
    () => `${arrayExpr(depth - 1)}.some((v: number): boolean => v > ${int(-2, 2)})`,
    () => `${arrayExpr(depth - 1)}.every((v: number): boolean => v >= ${int(-2, 2)})`,
    // `"a" in { a: 1 }` only: the key has to be a literal the compiler can see,
    // which a generated string expression is not.
    () => `(${stringLiteral()} in { a: 1, b: 2 } ? true : false)`,
    () => `(${s()} > ${s()})`,
    () => `(${s()} <= ${s()})`,
    () => `(${arrayExpr(depth - 1)}.length > ${int(0, 3)})`,
    () => `Number.isSafeInteger(${n()})`,
    () => `(typeof ${s()} === "string")`,
    () => `(typeof ${n()} === "number")`,
    () => `((${n()}) as number === (${n()}) as number ? ${b()} : ${b()})`,
    () => `Object.is(${n()}, ${n()})`,
    () => `(${arrayExpr(depth - 1)}.length === ${int(0, 3)})`,
  ])();
}

/** Always `number[]`, so every consumer of one typechecks. */
function arrayExpr(depth) {
  // **At least one element.** A generated `[]` refuses as "an array literal
  // that is not an array" --- a real refusal, and one already covered by
  // `examples/a-default-over-an-empty-source` and its blockers. Generating it
  // here spent most of a run's refusal budget re-finding it: 16 of the 20
  // refused groups across three seeds.
  const items = () =>
    Array.from({ length: int(1, 3) }, () => numberExpr(0)).join(", ");
  if (depth <= 0) return `[${items()}]`;
  const a = () => arrayExpr(depth - 1);
  return pick([
    () => `[${items()}]`,
    () => `${a()}.slice(${int(-2, 2)})`,
    () => `${a()}.concat(${a()})`,
    () => `${a()}.map((v: number): number => v ${pick(["+", "*", "-"])} ${int(1, 3)})`,
    () => `${a()}.filter((v: number): boolean => v ${pick([">", "<", ">=", "!=="])} ${int(-2, 2)})`,
  ])();
}

const KINDS = [
  ["number", (d) => numberExpr(d)],
  ["string", (d) => stringExpr(d)],
  ["boolean", (d) => boolExpr(d)],
];

/**
 * What node says each expression is, as a literal this program can paste.
 *
 * `undefined` for anything node itself threw on or that has no literal
 * spelling -- `NaN` and the infinities have none that survives a round trip
 * through `JSON.stringify`, so they are spelled out.
 */
function nodeAnswers(dir, exprs) {
  const lines = exprs.map(
    (e, i) => `try { print(${i}, ${e.code}); } catch { print(${i}, undefined); }`,
  );
  return runOracle(dir, `${PRINTER}
${lines.join("\n")}
console.log(JSON.stringify(out));
`);
}

/**
 * One program holding every assertion in the batch.
 *
 * A `-0` is asserted through `Object.is`, because `sameValue` compares with
 * `!==` and `0 !== -0` is false -- an assertion that cannot fail is not an
 * assertion, and this generator produces `-0` often enough to matter.
 */
function program(exprs, expected) {
  const body = exprs
    .map((e, i) => assertion(e.code, expected[i], `#${i}`))
    .filter(Boolean);
  return `${HARNESS}\n${body.join("\n")}\n`;
}

const dir = scratch("expr");

const totals = { agree: 0, differ: 0, refused: 0, typescript: 0, panic: 0, other: 0 };
const refusals = new Map();
const rejected = new Map();
const examples = new Map();
const found = [];

/**
 * Run a group, and split it when the compiler declines to build it.
 *
 * A batch exists to pay for one `cc` rather than forty. But a *random*
 * generator reaches constructs this compiler refuses all the time, and an
 * all-or-nothing batch means one refusal discards thirty-nine expressions that
 * would have compiled --- which is how the first run of this file reported
 * `0 agree, 40 refused` and measured almost nothing.
 *
 * So a refusal halves the group and tries again. A single expression that still
 * refuses is attributed to its own construct and dropped; everything beside it
 * is still measured. The cost is `log2(n)` extra builds on a refusal and none
 * at all on a clean batch.
 */
function measure(exprs, expected, depth = 0) {
  if (exprs.length === 0) return;
  const verdict = compileAndRun(join(dir, `g${depth}`), program(exprs, expected));

  if (verdict.kind === "agree") {
    totals.agree += exprs.length;
    return;
  }

  const splittable =
    exprs.length > 1 &&
    (verdict.kind === "refused" ||
      verdict.kind === "declined" ||
      verdict.kind === "typescript" ||
      verdict.kind === "cc-failed" ||
      verdict.kind === "invalid-hir" ||
      verdict.kind === "panic");
  if (splittable) {
    const half = Math.floor(exprs.length / 2);
    measure(exprs.slice(0, half), expected.slice(0, half), depth + 1);
    measure(exprs.slice(half), expected.slice(half), depth + 1);
    return;
  }

  if (verdict.kind === "refused" || verdict.kind === "declined") {
    totals.refused += exprs.length;
    refusals.set(verdict.detail, (refusals.get(verdict.detail) ?? 0) + 1);
    return;
  }
  if (verdict.kind === "typescript") {
    totals.typescript += exprs.length;
    // Counted by code, because "rejected by tsc" is the generator's own waste
    // and the code says which rule it keeps breaking.
    const code = (verdict.detail.match(/^TS\d+/) ?? ["TS?"])[0];
    rejected.set(code, (rejected.get(code) ?? 0) + 1);
    // At size one the expression *is* the cause, so keep one example per code.
    // Counting a rejection says the generator wastes samples; naming it says
    // which arm to fix.
    if (exprs.length === 1 && !examples.has(code)) examples.set(code, exprs[0].code);
    return;
  }
  if (verdict.kind === "invalid-hir") {
    totals.panic += exprs.length;
    found.push({ code: exprs[0].code, kind: "invalid-hir", detail: verdict.detail });
    return;
  }
  if (verdict.kind === "cc-failed" || verdict.kind === "panic") {
    // **A single expression that panics or emits C that will not build is a
    // finding**, and a loud one: it is not a refusal, so nothing named it.
    totals.panic += exprs.length;
    found.push({ code: exprs[0].code, kind: verdict.kind, detail: verdict.detail });
    return;
  }
  if (verdict.kind !== "differ") {
    totals.other += exprs.length;
    return;
  }

  const index = Number((verdict.detail.match(/#(\d+)/) ?? [])[1]);
  if (Number.isNaN(index) || !exprs[index]) {
    totals.differ += 1;
    found.push({ code: "<unidentified>", kind: "differ", detail: verdict.detail });
    return;
  }
  totals.differ += 1;
  totals.agree += exprs.length - 1;
  found.push({
    code: exprs[index].code,
    expected: expected[index],
    kind: "differ",
    detail: verdict.detail,
  });
}

for (let at = 0; at < CASES; at += BATCH) {
  const exprs = [];
  for (let i = 0; i < Math.min(BATCH, CASES - at); i += 1) {
    const [, make] = pick(KINDS);
    exprs.push({ code: make(int(1, 3)) });
  }
  const expected = nodeAnswers(dir, exprs);
  if (expected === null) {
    totals.other += exprs.length;
    continue;
  }
  measure(exprs, expected);
}

rmSync(dir, { recursive: true, force: true });

const label = `${CASES} expression(s), seed ${SEED}`;
if (found.length === 0) {
  // **`other` is printed even when it is zero.** The first run of this file
  // reported `ok  0 agree, 0 differ` because every batch had fallen into a
  // bucket the summary did not mention, and a line that cannot say "nothing
  // ran" reads exactly like a line that says "nothing was wrong".
  // No leading tool name: `divergence.sh` prints one, and its summary picks the
  // line containing "agree," --- which read `fuzz-expressions ok fuzz-expressions
  // ok …` while this printed its own.
  console.log(
    `${label}: ${totals.agree} agree, 0 differ, ` +
      `${totals.refused} refused, ${totals.typescript} rejected by tsc, ` +
      `${totals.other} unusable`,
  );
} else {
  console.log(
    `${label}: ${totals.agree} agree, ${found.length} differ, ` +
      `${totals.refused} refused  <-- DIFFER`,
  );
  for (const f of found) {
    console.log(`  ${f.kind.padEnd(11)} ${f.code}`);
    if (f.expected !== undefined) console.log(`              node: ${f.expected}`);
    if (f.kind === "invalid-hir") console.log(`              ${f.detail}`);
  }
}
if (rejected.size > 0) {
  const top = [...rejected.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`  rejected by tsc, by code:`);
  for (const [code, n] of top) {
    const eg = examples.get(code);
    console.log(`    ${String(n).padStart(3)}  ${code}${eg ? `   e.g. ${eg.slice(0, 68)}` : ""}`);
  }
}
if (refusals.size > 0) {
  const top = [...refusals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log(`  refused batches, by first reason:`);
  for (const [reason, n] of top) console.log(`    ${String(n).padStart(3)}  ${reason}`);
}

process.exitCode = found.length > 0 ? 1 : 0;
