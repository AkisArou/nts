/*---
description: "A nested object pattern retains the selected branch across its default. The control evaluates the parts in separate statements."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-interfaces, ts-objects, ts-accessors, ts-unions, ts-null-undefined, ts-this]
---*/
// A nested source crosses a class field; node keeps the old inner object while the default replaces the branch seen by the outer tail getter. The control names each ordered part.
const log: string[] = [];
interface Branch { first: number | undefined; second: number; }
class Holder { branch: Branch = { first: 0, second: 0 }; get tail(): number { log.push("get:tail"); return this.branch.second; } }
function replace(holder: Holder, input: number): number { log.push("default"); holder.branch = { first: 80, second: input + 100 }; return input + 10; }
function read(holder: Holder, input: number): number[] {
  log.push("read");
  const sourcePart = holder;
  const branchPart = sourcePart.branch;
  const firstPart = branchPart.first;
  let selected = firstPart;
  if (selected === undefined) { const fallback = replace(holder, input); selected = fallback; }
  const first = selected;
  const second = branchPart.second;
  const tail = sourcePart.tail;
  return [first, second, tail];
}
for (const missing of [false, true]) for (const input of [3, 9]) {
  log.length = 0; const holder = new Holder();
  const branch: Branch = { get first(): number | undefined { log.push("get:first"); return missing ? undefined : input; }, get second(): number { log.push("get:second"); return input + 1; } }; holder.branch = branch;
  const result = read(holder, input);
  assert.compareArray(log, missing ? ["read", "get:first", "default", "get:second", "get:tail"] : ["read", "get:first", "get:second", "get:tail", "get:second"]);
  assert.compareArray(result, [missing ? input + 10 : input, input + 1, missing ? input + 100 : input + 1]); assert.sameValue(holder.branch === branch, !missing);
}
