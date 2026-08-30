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
for (const kind of KINDS) {
  for (const ask of kind.asks) {
    count++;
    out.push(`export function ${kind.id}_${ask}(n: number): string {`);
    out.push(`  const v: ${kind.ts} = ${kind.expr};`);
    out.push(`  return ${ASKS[ask]("v")};`);
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

console.log(out.join("\n"));
console.error(`${count} cases across ${KINDS.length} value kinds`);
