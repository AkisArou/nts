/*---
description: Loose equality converts a retained object after the right operand mutates it.
features: [ts-evaluation-order-routes, ts-evaluation-order-route-operators, ts-interfaces, ts-unions, ts-class, ts-accessors, ts-objects, ts-functions, ts-tuples, ts-arrays, ts-iteration, ts-conversions, ts-to-primitive, ts-numbers]
---*/
// == through an interface union; node reads the right operand's mutation before converting the retained left object.
const log: string[] = [];
interface Hook { valueOf(): number; }
interface Source { readonly left: Hook | number; readonly right: number; }
let current = 0;
class Box implements Hook {
  valueOf(): number { log.push("convert:class:" + current); return current; }
}
const literal: Hook = { valueOf(): number { log.push("convert:literal:" + current); return current; } };
function equal(source: Source): boolean {
  log.push("equal");
  return source.left == source.right;
}
const rows: [Hook | number, string[], boolean][] = [[new Box(), ["convert:class:3"], true], [literal, ["convert:literal:3"], true], [2, [], false]];
for (const row of rows) {
  const source: Source = {
    get left(): Hook | number { log.push("get:left"); return row[0]; },
    get right(): number { log.push("get:right"); current = 3; return current; }
  };
  log.length = 0; current = 2;
  const result = equal(source);
  assert.compareArray(log, ["equal", "get:left", "get:right", ...row[1]]);
  assert.sameValue(result, row[2]);
  assert.sameValue(current, 3);
}
