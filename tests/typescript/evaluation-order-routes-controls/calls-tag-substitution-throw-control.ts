/*---
description: "Control for calls-tag-substitution-throw; A throwing substitution preserves earlier effects, skips later substitutions and keeps repeated-site identity."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-type-aliases, ts-function-types, ts-this, ts-objects, ts-accessors, ts-literal-types, ts-unions, ts-null-undefined, ts-unknown, ts-errors, ts-instanceof, ts-narrowing, ts-template-literals, ts-this-parameter]
---*/
// An interface getter carries a tag; node gets it first, stops at a throwing substitution and reuses the same strings array on successful calls before and after failure. The control uses ordered temporaries.
const log: string[] = [];
type Mode = "none" | "first" | "second";
type Tag = (this: Holder, strings: TemplateStringsArray, a: number, b: number, c: number) => number[];
interface Holder { count: number; current: Tag; readonly tag: Tag; }
const sites: TemplateStringsArray[] = [];
function tag(this: Holder, strings: TemplateStringsArray, a: number, b: number, c: number): number[] { log.push(`tag:${this.count}`); sites.push(strings); return [a, b, c]; }
function wrong(this: Holder, strings: TemplateStringsArray, a: number, b: number, c: number): number[] { log.push("wrong"); return []; }
function first(holder: Holder, mode: Mode): number { log.push(`first:${holder.count}`); holder.current = wrong; holder.count++; if (mode === "first") throw new RangeError("first"); return holder.count; }
function second(holder: Holder, mode: Mode): number { log.push(`second:${holder.count}`); holder.count += 10; if (mode === "second") throw new RangeError("second"); return holder.count; }
function third(holder: Holder): number { log.push(`third:${holder.count}`); holder.count += 100; return holder.count; }
const siteObject: TemplateStringsArray = Object.assign(["A", "B", "C", "D"], { raw: ["A", "B", "C", "D"] });
function run(holder: Holder, mode: Mode): number[] {
  log.push("run");
  const receiver = holder;
  const fn = receiver.tag;
  const strings = siteObject;
  const a = first(holder, mode);
  const b = second(holder, mode);
  const c = third(holder);
  return fn.call(receiver, strings, a, b, c);
}
const modes: Mode[] = ["none", "first", "second"];
for (const mode of modes) {
  const holder: Holder = { count: 0, current: tag, get tag(): Tag { log.push("get"); return this.current; } }, phases: Mode[] = ["none", mode, "none"]; sites.length = 0;
  for (const phase of phases) {
    holder.count = 0; holder.current = tag; log.length = 0; let result: number[] | undefined, caught: unknown; try { result = run(holder, phase); } catch (error: unknown) { caught = error; log.push("catch"); }
    const expected = ["run", "get", "first:0"]; if (phase !== "first") expected.push("second:1"); if (phase === "none") expected.push("third:11", "tag:111"); else expected.push("catch");
    assert.compareArray(log, expected);
    assert.sameValue(holder.count, phase === "first" ? 1 : phase === "second" ? 11 : 111); assert.sameValue(holder.current, wrong);
    if (phase === "none") { assert.sameValue(caught, undefined); if (result === undefined) throw new Error("missing result"); assert.compareArray(result, [1, 11, 111]); }
    else { assert.sameValue(result, undefined); assert.sameValue(caught instanceof RangeError, true); if (caught instanceof RangeError) { assert.sameValue(caught.constructor, RangeError); assert.sameValue(caught.message, phase); } }
  }
  assert.sameValue(sites.length, mode === "none" ? 3 : 2); for (const site of sites) { assert.sameValue(site, sites[0]); assert.sameValue(site.raw, sites[0].raw); assert.compareArray(site, ["A", "B", "C", "D"]); assert.compareArray(site.raw, ["A", "B", "C", "D"]); }
}
