/*---
description: "Generic inner and outer tags preserve raw values through a fresh typed packet instead of coercing nested substitutions."
features: [ts-template-routes, ts-template-route-nesting-composition, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-interfaces, ts-objects, ts-type-aliases, ts-unions, ts-generics, ts-generic-constraints, ts-numbers, ts-strings, ts-bigint, ts-symbols, ts-null-undefined, ts-template-literals, ts-tagged-templates]
---*/
// The inner tag logs and wraps each raw value; Node passes the same packet to the outer tag and returns its original primitive or object identity without coercion.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const seen: (TemplateStringsArray | undefined)[] = [];
function inspect(strings: TemplateStringsArray, site: number, parts: readonly string[]): void {
  assert.compareArray(strings, parts); assert.compareArray(strings.raw, parts); same(Object.isFrozen(strings), true); same(Object.isFrozen(strings.raw), true);
  if (seen[site] !== undefined) same(strings, seen[site]); seen[site] = strings;
}
interface NestMarker { label: string; toString(): string }
type NestValue = number | string | boolean | bigint | symbol | null | undefined | NestMarker;
interface NestPacket<T> { item: T }
const log: unknown[] = [], packets: NestPacket<NestValue>[] = [];
function marker(): NestMarker { return { label: "same", toString(): string { log.push("unexpected conversion"); return "same"; } }; }
const first = marker(), second = marker(), one = Symbol("same"), two = Symbol("same");
const inputs: NestValue[] = [0, -0, NaN, "", "\ud83d\ude42", true, false, 17n, null, undefined, first, second, one, two];
function wrap<T extends NestValue>(strings: TemplateStringsArray, value: T): NestPacket<T> {
  inspect(strings, 0, ["inner(", ")"]); log.push("wrap", value); const packet: NestPacket<T> = { item: value }; packets.push(packet); return packet;
}
function unwrap<T extends NestValue>(strings: TemplateStringsArray, packet: NestPacket<T>): T {
  inspect(strings, 1, ["outer(", ")"]); same(packet, packets[packets.length - 1]); log.push("unwrap", packet, packet.item); return packet.item;
}
function render<T extends NestValue>(value: T): T { return unwrap`outer(${wrap`inner(${value})`})`; }
for (const input of inputs) {
  log.length = 0; const result = render(input), packet = packets[packets.length - 1]; same(result, input); same(packet.item, input);
  exact(log, ["wrap", input, "unwrap", packet, input]);
}
same(packets.length, inputs.length); same(Object.is(first, second), false); same(Object.is(one, two), false);
for (let i = 0; i < packets.length; i++) { same(packets[i].item, inputs[i]); for (let j = 0; j < i; j++) same(Object.is(packets[i], packets[j]), false); }
