// A cross-product of value kinds and the operations that read them, generated
// rather than written, and settled by node.
//
// Every correctness bug found in this compiler by hand has been one cell of
// such a product: `null === undefined` answered true, `typeof f === "function"`
// answered false, `v === undefined` on a `string | null` answered true, a
// `bigint` `&` narrowed both operands to 32 bits. Each was invisible to a gate
// of ninety hand-written examples, because an example only covers what somebody
// thought to write down. A product covers what nobody did.
//
//   node tooling/sweep/sweep.mjs > /tmp/sweep/src/main.ts
//
// then `nts check` that project: the harness already runs each exported
// function against node and compares bit patterns.

// A value kind: how to produce one, and what it is legal to ask of it.
//
// `expr` must depend on `n` so nothing folds to a constant, and must produce
// every inhabitant of its type across the pool the harness drives it with.
const KINDS = [
  { id: "num", ts: "number", expr: "n", asks: ["typeof", "truthy", "loose"] },
  { id: "str", ts: "string", expr: '(n > 0 ? "a" : "")', asks: ["typeof", "truthy", "loose"] },
  { id: "bool", ts: "boolean", expr: "n > 0", asks: ["typeof", "truthy", "loose"] },
  { id: "big", ts: "bigint", expr: "(n > 0 ? 1n : 0n)", asks: ["typeof", "truthy"] },
  { id: "obj", ts: "{ a: number }", expr: "({ a: n })", asks: ["typeof", "truthy", "loose"] },
  { id: "arr", ts: "number[]", expr: "[n]", asks: ["typeof", "truthy", "loose"] },
  // No truthiness or `== null` here: the checker rejects both on a function
  // that is always defined, which is a fact about the *test* rather than about
  // this compiler, so the cell does not exist to be swept.
  { id: "fn", ts: "(x: number) => number", expr: "((x: number): number => x + n)", asks: ["typeof"] },
  // The absences, alone and together. Every one of this session's bugs lived
  // in one of these three rows.
  { id: "s_null", ts: "string | null", expr: '(n > 0 ? "a" : null)', asks: ["typeof", "truthy", "null", "undef", "loose", "nullish"] },
  { id: "s_undef", ts: "string | undefined", expr: '(n > 0 ? "a" : undefined)', asks: ["typeof", "truthy", "null", "undef", "loose", "nullish"] },
  { id: "s_both", ts: "string | null | undefined", expr: "threeWayString(n)", asks: ["typeof", "truthy", "null", "undef", "loose", "nullish"] },
  { id: "n_undef", ts: "number | undefined", expr: "(n > 0 ? n : undefined)", asks: ["typeof", "truthy", "null", "undef", "loose", "nullish"] },
  { id: "n_both", ts: "number | null | undefined", expr: "threeWayNumber(n)", asks: ["typeof", "truthy", "null", "undef", "loose", "nullish"] },
  // Held out: `{ a: number } | null` reaches the backend as an object type with
  // no layout, which it declines to emit. A real gap, reported by the sweep the
  // first time it ran, and not one this table can express around.
  // { id: "o_null", ts: "{ a: number } | null", ... },
  // Erased, which is where a tag has to answer what a representation cannot.
  { id: "u_num", ts: "unknown", expr: "(n as unknown)", asks: ["typeof", "truthy", "null", "undef", "loose"] },
  { id: "u_str", ts: "unknown", expr: '((n > 0 ? "a" : "") as unknown)', asks: ["typeof", "truthy", "null", "undef", "loose"] },
  { id: "u_fn", ts: "unknown", expr: "(((x: number): number => x + n) as unknown)", asks: ["typeof", "truthy", "null", "undef", "loose"] },
  { id: "u_obj", ts: "unknown", expr: "({ a: n } as unknown)", asks: ["typeof", "truthy", "null", "undef", "loose"] },
  { id: "u_null", ts: "unknown", expr: "(null as unknown)", asks: ["typeof", "truthy", "null", "undef", "loose"] },
  { id: "u_undef", ts: "unknown", expr: "(undefined as unknown)", asks: ["typeof", "truthy", "null", "undef", "loose"] },
];

// What can be asked of a value, as an expression yielding a comparable string.
const ASKS = {
  typeof: (v) => `typeof ${v}`,
  truthy: (v) => `(${v} ? "T" : "F")`,
  null: (v) => `(${v} === null ? "T" : "F") + (${v} !== null ? "t" : "f")`,
  undef: (v) => `(${v} === undefined ? "T" : "F") + (${v} !== undefined ? "t" : "f")`,
  loose: (v) => `(${v} == null ? "T" : "F") + (${v} != null ? "t" : "f")`,
  nullish: (v) => `String(${v} ?? "D")`,
  // Asked of every kind rather than listed per kind: node converts everything,
  // so every cell is either an agreement or a refusal this compiler owns and
  // can see. It is also where a `string | null` was caught being handed to a
  // concatenation as a null pointer -- which aborts rather than disagreeing,
  // and an aborted case is *not* counted in "agreed on every case".
  text: (v) => `String(${v}) + "|" + \`\${${v}}\` + "|" + ("" + ${v})`,
};

// The second product: equality *between* two erased values, over every pair of
// tags. `nts_value_strict_eq` switches on the tag and every cell of this is one
// of its arms -- which is also what a tag renumbering puts at risk, and the tag
// order changed twice this week.
//
// A reference kind appears twice: once as two separately made values, which
// JavaScript compares by identity and so answers false, and once as one value
// compared with itself.
const ERASED = [
  { id: "num", expr: "(n as unknown)" },
  { id: "str", expr: '((n > 0 ? "a" : "b") as unknown)' },
  { id: "bool", expr: "((n > 0) as unknown)" },
  { id: "nul", expr: "(null as unknown)" },
  { id: "und", expr: "(undefined as unknown)" },
  { id: "obj", expr: "({ a: n } as unknown)" },
  { id: "arr", expr: "([n] as unknown)" },
  { id: "fn", expr: "(((x: number): number => x + n) as unknown)" },
];

// The third: reading and writing through an index, per element type. The
// element's representation comes from the array rather than from the access,
// which is the decision this checks.
const ELEMENTS = [
  { id: "num", ts: "number[]", make: "[n, n + 1, n + 2]", write: "n * 2", show: "String(xs[0]) + String(xs[1]) + String(xs[2]) + String(xs.length)" },
  { id: "str", ts: "string[]", make: '[(n > 0 ? "a" : "b"), "c"]', write: '"z"', show: "xs[0] + xs[1] + String(xs.length)" },
  { id: "bool", ts: "boolean[]", make: "[n > 0, n < 0]", make_write: "n === 0", write: "n === 0", show: "String(xs[0]) + String(xs[1]) + String(xs.length)" },
];

// The fourth product: `+`, which is two operators wearing one token. Which one
// it is comes from the *type* -- `Concat` when the result is managed and `Add`
// otherwise -- so every legal pairing is a cell of that decision.
//
// Only the pairings TypeScript accepts under `strict`: it rejects `true + 1`
// and `1n + 1`, and a cell the checker will not admit is not a cell.
const PLUS = [
  ["number", "n", "number", "n + 1"],
  ["string", '(n > 0 ? "a" : "b")', "string", '"c"'],
  ["string", '(n > 0 ? "a" : "b")', "number", "n"],
  ["number", "n", "string", '(n > 0 ? "a" : "b")'],
  ["bigint", "(n > 0 ? 2n : 3n)", "bigint", "5n"],
];

// A field, per field type. A field's representation comes from the class
// layout rather than from the value written into it, which is the decision this
// checks -- and a field is where a value with an absence lives longest, since
// nothing narrows it between the write and the read.
//
// `init` fills it, `write` replaces it, and `show` is read before and after, so
// a layout that stored the right thing and read back the wrong one is visible
// rather than merely present.
const FIELDS = [
  { id: "num", ts: "number", init: "n", write: "n + 1", show: "String(b.f)" },
  { id: "str", ts: "string", init: '(n > 0 ? "a" : "b")', write: '"z"', show: "b.f" },
  { id: "bool", ts: "boolean", init: "n > 0", write: "n < 0", show: "String(b.f)" },
  { id: "big", ts: "bigint", init: "(n > 0 ? 1n : 2n)", write: "3n", show: "String(b.f)" },
  { id: "arr", ts: "number[]", init: "[n]", write: "[n, n + 1]", show: "String(b.f.length) + String(b.f[0])" },
  { id: "obj", ts: "{ a: number }", init: "({ a: n })", write: "({ a: n + 1 })", show: "String(b.f.a)" },
  { id: "s_null", ts: "string | null", init: '(n > 0 ? "a" : null)', write: "null", show: "String(b.f) + String(b.f === null)" },
  { id: "s_undef", ts: "string | undefined", init: '(n > 0 ? "a" : undefined)', write: "undefined", show: "String(b.f) + String(b.f === undefined)" },
  { id: "n_undef", ts: "number | undefined", init: "(n > 0 ? n : undefined)", write: "undefined", show: "String(b.f) + typeof b.f" },
  { id: "unk", ts: "unknown", init: "(n as unknown)", write: '("z" as unknown)', show: "String(b.f) + typeof b.f" },
];

// An array method, per element type. The element's representation comes from
// the array, so a method that builds or returns elements has to agree with it
// -- `pop` returns `T | undefined`, which is a *different* representation from
// `T` for every scalar `T`, and that is the cell worth having.
const ARRAY_METHODS = [
  ["length", "String(xs.length)"],
  // Guarded, because `xs[-1]` on an empty array is TypeScript's unsoundness
  // rather than a cell: it is typed `number`, node answers `undefined`, and
  // this compiler's bounds check stops the program -- which is the right
  // answer to a promise the checker made and the value did not keep. `at(-1)`
  // is the spelling that is defined for it, and `at_far` asks that.
  ["index_end", 'xs.length > 0 ? String(xs[xs.length - 1]) : "empty"'],
  ["push", "xs.push(w) + \"|\" + String(xs.length) + \"|\" + String(xs[xs.length - 1])"],
  ["pop", "String(xs.pop()) + \"|\" + String(xs.length) + \"|\" + String(xs.pop())"],
  ["at_far", "String(xs.at(9)) + \"|\" + String(xs.at(0)) + \"|\" + String(xs.at(-1))"],
  ["pop_absent", "String(xs.pop() === undefined) + \"|\" + String(xs.pop() ?? -7)"],
  ["indexof", "String(xs.indexOf(w))"],
  ["includes", "String(xs.includes(w))"],
  ["join", 'xs.join(",") + "|" + xs.join("") + "|" + xs.join()'],
  ["push_many", 'String(xs.push(w, w)) + "|" + String(xs.length) + "|" + String(xs[xs.length - 1])'],
  ["slice", "xs.slice(1).join(\",\")"],
];

// An empty array is its own row. `pop` and `at` answer `undefined` there, which
// for a number is a *different representation* from every other answer they
// give -- and NaN stood in for it, so `String([].pop())` said "NaN" where node
// says "undefined". Nothing in this file reached an empty array until it did.
const ARRAY_ELEMENTS = [
  { id: "num", ts: "number", make: "[n, n + 1, n + 2]", w: "n + 1" },
  { id: "empty", ts: "number", make: "[]", w: "n" },
  { id: "str", ts: "string", make: '[(n > 0 ? "a" : "b"), "c", "d"]', w: '"c"' },
  { id: "bool", ts: "boolean", make: "[n > 0, n < 0, n === 0]", w: "n < 0" },
  // A reference element, where `indexOf` compares by *value* for a string and
  // by identity for everything else. `w` is built separately from the array's
  // own elements on purpose: for the string row it must still be found, and for
  // the object row it must not.
  { id: "ref", ts: "string", make: '["a" + String(n), "b", "c"]', w: '"a" + String(n)' },
];

// `+` where an operand's representation is *erased*. A `number | undefined`
// narrowed to a number is still one word plus a tag until something unerases
// it, and `+` is the operator that cannot be told which one it is: `Add` and
// `Concat` are chosen by the result type, and an erased operand has none.
const ERASED_PLUS = [
  ["num_narrowed", "number | undefined", "(n > 0 ? n : undefined)", "x + 1", "0"],
  ["str_narrowed", "string | undefined", '(n > 0 ? "a" : undefined)', 'x + "b"', '"-"'],
  ["str_null", "string | null", '(n > 0 ? "a" : null)', 'x + "b"', '"-"'],
  ["num_null", "number | null | undefined", "(n > 0 ? n : null)", "x + 1", "0"],
];

// The fifth: turning a number into text, which has to be exact. The harness
// drives these with its pool, so every awkward double it holds -- the zeroes,
// the infinities, NaN, the very large and the very small -- goes through each
// of these spellings and is compared against node's own.
const TEXT = [
  ["string_of", "String(x)"],
  ["template", "`${x}`"],
  ["concat_left", '"" + x'],
  ["concat_right", 'x + ""'],
  ["in_the_middle", '"[" + x + "]"'],
];

// The sixth: arithmetic, compared as text so the whole result is checked rather
// than a truncation of it.
const ARITH = [
  ["add", "x + 1"],
  ["sub", "x - 1"],
  ["mul", "x * 3"],
  ["div", "x / 3"],
  ["rem", "x % 7"],
  ["pow", "x ** 2"],
  ["neg", "-x"],
  ["band", "x & 255"],
  ["bor", "x | 1"],
  ["bxor", "x ^ 15"],
  ["bnot", "~x"],
  ["shl", "x << 3"],
  ["shr", "x >> 3"],
  ["ushr", "x >>> 3"],
  ["min_like", "x < 0 ? -x : x"],
];

// The seventh: a `bigint` as text and under its own operators. Exact to 128
// bits, no exponent however large, and a shift count that is *not* masked to
// five -- `1n << 100n` folded to 16 while this row was being written, because
// the double lattice was still being asked about it.
const BIGINT = [
  ["small", "a"],
  ["negative", "a - 10n"],
  ["wide", "a * 1000000000000000000n"],
  ["shifted", "1n << 100n"],
  ["shifted_back", "(1n << 100n) >> 60n"],
  ["negative_count", "1n << -1n"],
  ["masked_and", "0xffffffffffn & 0xffn"],
  ["zero", "a - a"],
  ["max", "170141183460469231731687303715884105727n"],
];

const out = [];
out.push("// Generated by tooling/sweep/sweep.mjs. Do not edit.");
out.push("");
// Written as statements rather than as a nested conditional: the inner arm of
// `a ? x : b ? null : undefined` is typed `null | undefined`, a union of
// nothing but absences, which has no representation. That is a real refusal and
// not the cell being swept, so the shape avoids it.
out.push("function threeWayString(n: number): string | null | undefined {");
out.push('  if (n > 0) return "a";');
out.push("  if (n < -1) return null;");
out.push("  return undefined;");
out.push("}");
out.push("");
out.push("function threeWayNumber(n: number): number | null | undefined {");
out.push("  if (n > 0) return n;");
out.push("  if (n < -1) return null;");
out.push("  return undefined;");
out.push("}");
out.push("");
let count = 0;
// Each cell twice: once on a local, and once on a value that arrived as a
// parameter.
//
// Not redundancy -- the two can have different *representations* of the same
// TypeScript type. A `const v: (x: number) => number = (x) => x` is lowered
// from its initializer, so it is the concrete closure; the parameter has only
// the annotation, so it is the function type. `typeof` answered "function" for
// the first and "object" for the second, and this file asked only the first.
// A parameter is also the only one of the two that a caller can pass an
// absence to without the callee's declaration mentioning it.
for (const kind of KINDS) {
  for (const ask of [...kind.asks, "text"]) {
    count++;
    out.push(`export function ${kind.id}_${ask}(n: number): string {`);
    out.push(`  const v: ${kind.ts} = ${kind.expr};`);
    out.push(`  return ${ASKS[ask]("v")};`);
    out.push(`}`);
    out.push("");
    count++;
    out.push(`function ${kind.id}_${ask}_at(v: ${kind.ts}): string {`);
    out.push(`  return ${ASKS[ask]("v")};`);
    out.push(`}`);
    out.push(`export function ${kind.id}_${ask}_param(n: number): string {`);
    out.push(`  return ${kind.id}_${ask}_at(${kind.expr});`);
    out.push(`}`);
    out.push("");
  }
}
for (const a of ERASED) {
  for (const b of ERASED) {
    count++;
    out.push(`export function eq_${a.id}_${b.id}(n: number): string {`);
    out.push(`  const x: unknown = ${a.expr};`);
    out.push(`  const y: unknown = ${b.expr};`);
    out.push(`  return (x === y ? "T" : "F") + (x !== y ? "t" : "f");`);
    out.push(`}`);
    out.push("");
  }
}

// The loose operator gets its own function per pair, so that refusing it costs
// only its own cell. `==` between two erased values coerces -- `1 == true` is
// true, and so is `[1] == 1` -- and this compiler has no `ToPrimitive`, so it
// refuses. The cells are generated anyway: a refusal is visible in the run, and
// the day they are answered the check is already written.
for (const a of ERASED) {
  for (const b of ERASED) {
    count++;
    out.push(`export function loose_${a.id}_${b.id}(n: number): string {`);
    out.push(`  const x: unknown = ${a.expr};`);
    out.push(`  const y: unknown = ${b.expr};`);
    out.push(`  return (x == y ? "L" : "N") + (x != y ? "l" : "n");`);
    out.push(`}`);
    out.push("");
  }
}

// The same value on both sides, which is the other half of identity.
for (const a of ERASED) {
  count++;
  out.push(`export function eq_${a.id}_self(n: number): string {`);
  out.push(`  const x: unknown = ${a.expr};`);
  out.push(`  const y: unknown = x;`);
  out.push(`  return (x === y ? "T" : "F") + (x == y ? "L" : "N");`);
  out.push(`}`);
  out.push("");
}

for (const e of ELEMENTS) {
  count++;
  out.push(`export function elem_${e.id}(n: number): string {`);
  out.push(`  const xs: ${e.ts} = ${e.make};`);
  out.push(`  const before = ${e.show};`);
  out.push(`  xs[1] = ${e.write};`);
  out.push(`  return before + "|" + ${e.show};`);
  out.push(`}`);
  out.push("");
}

for (const f of FIELDS) {
  count++;
  out.push(`class Held_${f.id} {`);
  out.push(`  f: ${f.ts};`);
  out.push(`  constructor(v: ${f.ts}) {`);
  out.push(`    this.f = v;`);
  out.push(`  }`);
  out.push(`}`);
  out.push(`export function field_${f.id}(n: number): string {`);
  out.push(`  const b = new Held_${f.id}(${f.init});`);
  out.push(`  const before = ${f.show};`);
  out.push(`  b.f = ${f.write};`);
  out.push(`  return before + "|" + ${f.show};`);
  out.push(`}`);
  out.push("");
}

for (const e of ARRAY_ELEMENTS) {
  for (const [name, expr] of ARRAY_METHODS) {
    count++;
    out.push(`export function am_${e.id}_${name}(n: number): string {`);
    out.push(`  const xs: ${e.ts}[] = ${e.make};`);
    out.push(`  const w: ${e.ts} = ${e.w};`);
    out.push(`  return ${expr};`);
    out.push(`}`);
    out.push("");
  }
}

for (const [name, ts, make, expr, absent] of ERASED_PLUS) {
  count++;
  out.push(`export function eplus_${name}(n: number): string {`);
  out.push(`  const v: ${ts} = ${make};`);
  out.push(`  if (v === null || v === undefined) {`);
  out.push(`    return String(${absent});`);
  out.push(`  }`);
  out.push(`  const x = v;`);
  out.push(`  return String(${expr});`);
  out.push(`}`);
  out.push("");
}

for (const [lt, le, rt, re] of PLUS) {
  count++;
  const id = `plus_${lt}_${rt}`;
  out.push(`export function ${id}(n: number): string {`);
  out.push(`  const a: ${lt} = ${le};`);
  out.push(`  const b: ${rt} = ${re};`);
  out.push(`  return String(a + b);`);
  out.push(`}`);
  out.push("");
}

for (const [id, expr] of TEXT) {
  count++;
  out.push(`export function text_${id}(n: number): string {`);
  out.push(`  const x: number = n;`);
  out.push(`  return ${expr};`);
  out.push(`}`);
  out.push("");
}

for (const [id, expr] of ARITH) {
  count++;
  out.push(`export function arith_${id}(n: number): string {`);
  out.push(`  const x: number = n;`);
  out.push(`  return String(${expr});`);
  out.push(`}`);
  out.push("");
}

for (const [id, expr] of BIGINT) {
  count++;
  out.push(`export function big_${id}(n: number): string {`);
  out.push(`  const a: bigint = n > 0 ? 2n : 3n;`);
  out.push(`  return String(${expr});`);
  out.push(`}`);
  out.push("");
}

// The eighth: relational comparison, which is four operators and was swept for
// none of them.
//
// `a < b` on two strings reached both backends as a comparison of two
// *addresses*, so it answered whatever the allocator had done. `===` was
// correct the whole time, because `nts_string_eq` was written and its
// relational siblings were not -- half a rule, and the missing half had no
// cell here to fall into. That is the argument this file is built on, turned
// on the file itself: every correctness bug found by hand has been one cell of
// a product, and this was a cell the product did not have.
//
// All four operators in one cell, because the interesting failures disagree
// with `===` rather than with each other, and a cell that asks only `<` cannot
// see a `<=` that forgot its equal case.
const RELATIONAL = [
  // Ordered both ways, so a comparison that answers a constant is caught.
  ["str_ordered", "string", '(n > 0 ? "a" : "b")', '"b"'],
  ["str_reversed", "string", '(n > 0 ? "b" : "a")', '"a"'],
  // Equal content, two allocations. The pair `nts_string_eq` exists for, asked
  // of the operators that never got it: `"a" + "b"` and `"ab"` are one string
  // to the language and two objects to the runtime.
  ["str_equal_built", "string", '("a" + (n > 0 ? "b" : "b"))', '"ab"'],
  // A prefix against its extension. `"a" < "ab"` is true and no length
  // comparison alone gets there.
  ["str_prefix", "string", '(n > 0 ? "ab" : "a")', '"a"'],
  // Upper case sorts below lower: 'Z' is 90 and 'a' is 97. A comparison that
  // folded case would answer this backwards.
  ["str_case", "string", '(n > 0 ? "Z" : "a")', '"a"'],
  // Above the BMP, where the answer distinguishes the rule from its neighbour.
  // The language compares UTF-16 *code units*: "\u{1F600}" leads with the
  // surrogate 0xD83D, which is below 0xFFFD, so it sorts first. Compared by
  // code *point* -- 0x1F600 against 0xFFFD -- it sorts last. Both are
  // defensible readings of "compare the strings" and only one is JavaScript.
  ["str_above_bmp", "string", '(n > 0 ? "\\u{1F600}" : "a")', '"\\uFFFD"'],
  // A wide string against a narrow one, which is the representation seam:
  // these cannot be compared byte against byte whatever the rule.
  ["str_wide_narrow", "string", '(n > 0 ? "\\u00ff" : "\\u0100")', '"a"'],
  ["num_ordered", "number", "n", "0"],
  // NaN makes every one of the four false, which is the property that makes
  // `!(a > b)` and `a <= b` different predicates. A backend that implements
  // one as the negation of the other answers this wrong and nothing else.
  ["num_nan", "number", "((n - n) / (n - n))", "0"],
  ["big_ordered", "bigint", "(n > 0 ? 1n : 3n)", "2n"],
  ["bool_ordered", "boolean", "(n > 0)", "false"],
];

for (const [id, ts, x, y] of RELATIONAL) {
  count++;
  out.push(`export function rel_${id}(n: number): string {`);
  out.push(`  const x: ${ts} = ${x};`);
  out.push(`  const y: ${ts} = ${y};`);
  out.push(
    `  return (x < y ? "T" : "F") + (x <= y ? "T" : "F") + ` +
      `(x > y ? "T" : "F") + (x >= y ? "T" : "F");`,
  );
  out.push(`}`);
  out.push("");
}

// A boolean as text used to be written out here in the three spellings that
// reach it. The `text` ask now does that for every kind, including this one.

console.log(out.join("\n"));
console.error(`${count} cases across ${KINDS.length} value kinds`);
