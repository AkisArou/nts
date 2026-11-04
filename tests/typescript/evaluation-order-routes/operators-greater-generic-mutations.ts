/*---
description: Relational greater keeps evaluation and conversion mutations in order.
features: [ts-evaluation-order-routes, ts-evaluation-order-route-operators, ts-generics, ts-generic-constraints, ts-interfaces, ts-accessors, ts-objects, ts-functions, ts-tuples, ts-arrays, ts-iteration, ts-conversions, ts-to-primitive, ts-numbers]
---*/
// > through a constrained Hook interface; node evaluates both getters before left then right conversion, even for > and >=.
const log: string[] = [];
interface Hook { valueOf(): number; }
interface Source { readonly left: Hook; readonly right: Hook; }
function compare<T extends Source>(source: T): boolean {
  log.push("compare");
  return source.left > source.right;
}
const rows: [number, number, boolean][] = [[1, 3, false], [3, 2, true], [1, 2, false], [NaN, 2, false]];
for (const row of rows) {
  let leftValue = row[0], rightValue = 99;
  const left: Hook = { valueOf(): number { log.push("convert:left:" + leftValue); rightValue = row[1]; return leftValue; } };
  const right: Hook = { valueOf(): number { log.push("convert:right:" + rightValue); return rightValue; } };
  const source: Source = {
    get left(): Hook { log.push("get:left"); return left; },
    get right(): Hook { log.push("get:right"); leftValue++; return right; }
  };
  log.length = 0;
  const result = compare(source);
  assert.compareArray(log, ["compare", "get:left", "get:right", "convert:left:" + (row[0] + 1), "convert:right:" + row[1]]);
  assert.sameValue(result, row[2]);
  assert.sameValue(leftValue, row[0] + 1);
  assert.sameValue(rightValue, row[1]);
}
