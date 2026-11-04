/*---
description: "Control for calls-tag-noncallable-assign; A noncallable tag throws only after its substitutions repair the backing field."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-type-aliases, ts-function-types, ts-this, ts-objects, ts-accessors, ts-tuples, ts-unions, ts-null-undefined, ts-unknown, ts-errors, ts-instanceof, ts-narrowing, ts-unsound-object-assign, ts-template-literals, ts-this-parameter]
---*/
// An ordinarily overwritten interface tag field is captured before its substitutions; node evaluates both substitutions and only then throws TypeError for the old noncallable tag. The control uses ordered temporaries.
const log: string[] = [];
type Tag = (this: Host, strings: TemplateStringsArray, a: number, b: number) => number[];
interface Host { current: Tag; value: number; readonly tag: Tag; }
const sites: TemplateStringsArray[] = [];
function good(this: Host, strings: TemplateStringsArray, a: number, b: number): number[] { log.push(`good:${this.value}:${a}:${b}`); sites.push(strings); return [a, b]; }
function repaired(this: Host, strings: TemplateStringsArray, a: number, b: number): number[] { log.push("repaired"); return []; }
function first(host: Host, n: number): number { log.push(`first:${n}`); host.current = repaired; host.value = n; return n + 1; }
function second(host: Host): number { log.push(`second:${host.value}`); return host.value + 2; }
const siteObject: TemplateStringsArray = Object.assign(["L", "M", "R"], { raw: ["L", "M", "R"] });
function run(host: Host, n: number): number[] {
  log.push("run");
  const receiver = host;
  const fn = receiver.tag;
  const strings = siteObject;
  const a = first(host, n);
  const b = second(host);
  return fn.call(receiver, strings, a, b);
}
const rows: [unknown, boolean][] = [[0, false], [null, false], [undefined, false], [false, false], [{}, false], [good, true]];
for (const row of rows) for (const n of [0, 3]) {
  const host: Host = { current: good, value: 9, get tag(): Tag { log.push("get"); return this.current; } }; Object.assign(host, { current: row[0] }); log.length = 0; let result: number[] | undefined, caught: unknown;
  try { result = run(host, n); } catch (error: unknown) { caught = error; log.push("catch"); }
  assert.compareArray(log, ["run", "get", `first:${n}`, `second:${n}`, row[1] ? `good:${n}:${n + 1}:${n + 2}` : "catch"]);
  assert.sameValue(host.current, repaired); assert.sameValue(host.value, n);
  if (row[1]) { assert.sameValue(caught, undefined); if (result === undefined) throw new Error("missing result"); assert.compareArray(result, [n + 1, n + 2]); }
  else { assert.sameValue(result, undefined); assert.sameValue(caught instanceof TypeError, true); if (caught instanceof TypeError) assert.sameValue(caught.constructor, TypeError); }
}
assert.sameValue(sites.length, 2); assert.sameValue(sites[0], sites[1]); assert.sameValue(sites[0].raw, sites[1].raw); assert.compareArray(sites[0], ["L", "M", "R"]); assert.compareArray(sites[0].raw, ["L", "M", "R"]);
