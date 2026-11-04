/*---
description: "Control for calls-tag-substitution-live-state; A method tag is captured before substitutions replace its receiver route and later payload."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-type-aliases, ts-function-types, ts-this, ts-tuples, ts-objects, ts-accessors, ts-template-literals, ts-this-parameter]
---*/
// An interface field carries the tag receiver; node reads its tag first, runs substitutions left to right and reuses one strings array while the selected tag and receiver change. The control uses ordered temporaries.
const log: string[] = [];
interface Payload { value: number; }
type Tag = (this: Host, strings: TemplateStringsArray, a: Payload, b: Payload) => [Payload, Payload];
interface Host { label: string; current: Tag; readonly tag: Tag; }
interface State { active: Host; first: Payload; second: Payload; }
const sites: TemplateStringsArray[] = [], receivers: Host[] = [];
function old(this: Host, strings: TemplateStringsArray, a: Payload, b: Payload): [Payload, Payload] { log.push(`old:${this.label}:${a.value}:${b.value}`); sites.push(strings); receivers.push(this); return [a, b]; }
function newer(this: Host, strings: TemplateStringsArray, a: Payload, b: Payload): [Payload, Payload] { log.push(`new:${this.label}:${a.value}:${b.value}`); sites.push(strings); receivers.push(this); return [a, b]; }
function first(state: State, next: Host): Payload { log.push(`sub1:${state.active.label}`); state.active.current = newer; state.active = next; state.second = { value: state.first.value + 10 }; return state.first; }
function second(state: State): Payload { log.push(`sub2:${state.active.label}:${state.second.value}`); return state.second; }
const siteObject: TemplateStringsArray = Object.assign(["x", "y", "z"], { raw: ["x", "y", "z"] });
function run(state: State, next: Host): [Payload, Payload] {
  log.push("run");
  const receiver = state.active;
  const fn = receiver.tag;
  const strings = siteObject;
  const a = first(state, next);
  const b = second(state);
  return fn.call(receiver, strings, a, b);
}
for (const n of [0, 3, -2]) {
  const original: Host = { label: "old", current: old, get tag(): Tag { log.push("get:old"); return this.current; } }, next: Host = { label: "next", current: newer, get tag(): Tag { log.push("get:next"); return this.current; } };
  const payload: Payload = { value: n }, state: State = { active: original, first: payload, second: { value: -1 } }; log.length = 0; sites.length = 0; receivers.length = 0;
  const a = run(state, next), captured = state.second, b = run(state, next);
  assert.compareArray(log, ["run", "get:old", "sub1:old", `sub2:next:${n + 10}`, `old:old:${n}:${n + 10}`, "run", "get:next", "sub1:next", `sub2:next:${n + 10}`, `new:next:${n}:${n + 10}`]);
  assert.sameValue(a[0], payload); assert.sameValue(a[1], captured); assert.sameValue(b[0], payload); assert.sameValue(b[1], state.second); assert.sameValue(a[1] === b[1], false); assert.sameValue(b[1].value, n + 10); assert.sameValue(state.active, next); assert.sameValue(original.current, newer); assert.compareArray(receivers, [original, next]);
  assert.sameValue(sites.length, 2); assert.sameValue(sites[0], sites[1]); assert.sameValue(sites[0].raw, sites[1].raw); assert.compareArray(sites[0], ["x", "y", "z"]); assert.compareArray(sites[0].raw, ["x", "y", "z"]);
}
