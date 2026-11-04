/*---
description: "Control for calls-defaults-constructor-throw; A throwing constructor parameter default runs after all arguments and prevents later defaults and the body."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-type-aliases, ts-construct-signatures, ts-class, ts-class-fields, ts-this, ts-new-target, ts-tuples, ts-readonly, ts-unions, ts-null-undefined, ts-unknown, ts-errors, ts-instanceof, ts-narrowing, ts-closures, ts-template-literals]
---*/
// A typed constructor return carries dependent defaults; node selects the constructor, evaluates all arguments, then stops at the throwing default before later initialization. The control uses ordered temporaries.
const log: string[] = [];
let fail = false;
type Ctor = new(a: number | undefined, b: number | undefined, c: number | undefined) => Item;
function choose(): Ctor { log.push("choose"); return Item; }
function read(label: string, value: number | undefined): number | undefined { log.push(`arg:${label}:${value}`); return value; }
function initA(): number { log.push("default:a"); return 2; }
function initB(a: number): number { log.push(`default:b:${a}`); if (fail) throw new RangeError("default-b"); return a + 3; }
function initC(a: number, b: number): number { log.push(`default:c:${a}:${b}`); return a + b; }
class Item {
  values: number[]; target: Function;
  constructor(rawA: number | undefined, rawB: number | undefined, rawC: number | undefined) {
    let a = rawA; if (a === undefined) { const value = initA(); a = value; }
    let b = rawB; if (b === undefined) { const value = initB(a); b = value; }
    let c = rawC; if (c === undefined) { const value = initC(a, b); c = value; }
    log.push(`body:${a}:${b}:${c}`); this.values = [a, b, c]; this.target = new.target;
  }
}
function run(row: readonly (number | undefined)[]): Item {
  log.push("run");
  const C = choose();
  const a = read("a", row[0]);
  const b = read("b", row[1]);
  const c = read("c", row[2]);
  return new C(a, b, c);
}
const rows: [number | undefined, number | undefined, number | undefined, number, number, number][] = [[undefined, undefined, undefined, 2, 5, 7], [3, undefined, undefined, 3, 6, 9], [undefined, 0, undefined, 2, 0, 2], [1, 2, 3, 1, 2, 3]];
for (const row of rows) for (const throwing of [false, true]) {
  fail = throwing; log.length = 0; let result: Item | undefined, caught: unknown; const throws = throwing && row[1] === undefined;
  try { result = run(row); } catch (error: unknown) { caught = error; log.push("catch"); }
  const expected = ["run", "choose", `arg:a:${row[0]}`, `arg:b:${row[1]}`, `arg:c:${row[2]}`]; if (row[0] === undefined) expected.push("default:a"); if (row[1] === undefined) expected.push(`default:b:${row[3]}`); if (throws) expected.push("catch"); else { if (row[2] === undefined) expected.push(`default:c:${row[3]}:${row[4]}`); expected.push(`body:${row[3]}:${row[4]}:${row[5]}`); }
  assert.compareArray(log, expected);
  if (throws) { assert.sameValue(result, undefined); assert.sameValue(caught instanceof RangeError, true); if (caught instanceof RangeError) { assert.sameValue(caught.constructor, RangeError); assert.sameValue(caught.message, "default-b"); } }
  else { assert.sameValue(caught, undefined); assert.sameValue(result instanceof Item, true); if (result instanceof Item) { assert.compareArray(result.values, [row[3], row[4], row[5]]); assert.sameValue(result.target, Item); } }
}
