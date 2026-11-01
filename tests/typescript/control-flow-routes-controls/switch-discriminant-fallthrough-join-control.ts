/*---
description: "Control for switch-discriminant-fallthrough-join; Fallthrough joins two discriminated packet members before a common-field read and preserves later switch exits."
features: [ts-control-flow-routes, ts-control-flow-route-switch, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-discriminated-unions, ts-narrowing, ts-errors]
---*/
// The packet kind narrows each selected arm; number falls into text so node reads their common union payload, while missing and reference arms exit separately. The control selects arms with explicit ifs and fallthrough state.
type SwitchValue = number | string | undefined | null | { id: number };
const marker = { id: 7 }, other = { id: 8 };
const inputs: SwitchValue[] = [-0, NaN, "", "tail", undefined, null, marker, other];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type SwitchPacket = { kind: "number"; value: number } | { kind: "text"; value: string } | { kind: "absent"; value: undefined | null } | { kind: "ref"; value: { id: number } };
const packets: SwitchPacket[] = [{kind:"number",value:-0},{kind:"number",value:NaN},{kind:"text",value:""},{kind:"text",value:"tail"},{kind:"absent",value:undefined},{kind:"absent",value:null},{kind:"ref",value:marker},{kind:"ref",value:other}];
function route(packet: SwitchPacket, log: unknown[]): SwitchValue {
  let result: SwitchValue = other;
  let falling = false;
  if (packet.kind === "number") { log.push("number", packet.value, packet.value.toFixed(0)); falling = true; }
  if (falling || packet.kind === "text") { log.push("joined", packet.value); result = packet.value; }
  else if (packet.kind === "absent") { log.push("absent", packet.value); result = packet.value; }
  else if (packet.kind === "ref") { log.push("ref", packet.value, packet.value.id); result = packet.value; }
  else { log.push("default", packet); throw new Test262Error("unreachable"); }
  log.push("exit", result); return result;
}
for (let at = 0; at < packets.length; at++) {
  const packet = packets[at], log: unknown[] = [], expected: unknown[] = [], result = route(packet, log);
  if (at < 2) expected.push("number", inputs[at], at === 0 ? "0" : "NaN");
  if (at < 4) expected.push("joined", inputs[at]);
  else if (at < 6) expected.push("absent", inputs[at]); else expected.push("ref", inputs[at], at === 6 ? 7 : 8);
  expected.push("exit", inputs[at]); same(result, inputs[at]); assert.compareArray(log, expected);
}
