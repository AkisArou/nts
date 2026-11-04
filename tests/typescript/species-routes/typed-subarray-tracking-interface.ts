/*---
description: A length-tracking Float64Array subarray preserves automatic length only when end is omitted, with exact constructor targets and resize histories.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-class-fields, ts-interfaces, ts-construct-signatures, ts-tuples, ts-rest-parameters, ts-symbols, ts-accessors, ts-static, ts-this, ts-override, ts-numbers]
---*/
// subarray crosses an interface view and tracking flag; node preserves selected class, buffer, offset, values and tracking, with only its known trailing-undefined arity deviation unasserted.
const log: unknown[] = [], calls: unknown[][] = [];
// Pinned node passes an extra undefined for tracking plus omitted end; that arity alone is unasserted (PR reproducer).
class SpeciesTracking extends Float64Array {
  marker: number = 7;
  constructor(...args: [ArrayBuffer, number, number?]) { super(args[0], args[1], args[2]); log.push("view", new.target); calls.push([...args]); }
  static get [Symbol.species](): Function { log.push("species", this); return this; }
}
class SpeciesTrackingChild extends SpeciesTracking {}
class SpeciesTrackingSibling extends SpeciesTracking { static override get [Symbol.species](): Function { log.push("sibling.species", this); return Float64Array; } }
interface Slot { view: Float64Array; tracking: boolean; }
type Factory = { new (...args: [ArrayBuffer, number, number?]): Float64Array; readonly prototype: object };
function apply(slot: Slot, omitted: boolean): Float64Array { return omitted ? slot.view.subarray(1) : slot.view.subarray(1, 3); }
const factories: Factory[] = [SpeciesTracking, SpeciesTrackingChild, SpeciesTrackingSibling, Float64Array];
for (const input of [-0, 2.5]) for (const factory of factories) for (const tracking of [false, true]) for (const omitted of [false, true]) {
  const buffer = new ArrayBuffer(40, { maxByteLength: 64 }), args: [ArrayBuffer, number, number?] = tracking ? [buffer, 8] : [buffer, 8, 4];
  log.length = 0; calls.length = 0; const view: Float64Array = new factory(...args);
  assert.compareArray(log, factory === Float64Array ? [] : ["view", factory]); assert.sameValue(calls.length, factory === Float64Array ? 0 : 1); if (factory !== Float64Array) assert.compareArray(calls[0], args);
  for (let i = 0; i < 4; i++) view[i] = i === 1 ? input : i + 10;
  const slot: Slot = { view, tracking }; log.length = 0; calls.length = 0; const result = apply(slot, omitted), selected = factory === SpeciesTrackingSibling ? Float64Array : factory;
  const resultArgs: unknown[] = tracking && omitted ? [buffer, 16] : [buffer, 16, omitted ? 3 : 2], wanted: unknown[] = factory === Float64Array ? [] : [factory === SpeciesTrackingSibling ? "sibling.species" : "species", factory];
  if (selected !== Float64Array) wanted.push("view", selected); assert.compareArray(log, wanted); assert.sameValue(calls.length, selected === Float64Array ? 0 : 1);
  if (selected !== Float64Array) { if (tracking && omitted) { assert.sameValue(calls[0][0], buffer); assert.sameValue(calls[0][1], 16); } else assert.compareArray(calls[0], resultArgs); }
  assert.compareArray([result instanceof SpeciesTracking, result instanceof SpeciesTrackingChild, result instanceof SpeciesTrackingSibling, result instanceof Float64Array, result instanceof Object], [selected !== Float64Array, selected === SpeciesTrackingChild, false, true, true]);
  const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, selected.prototype); assert.sameValue(ArrayBuffer.isView(result), true); assert.sameValue(result.buffer, buffer);
  const initial = omitted ? 3 : 2; assert.sameValue(result.length, initial); assert.sameValue(result.byteOffset, 16); assert.sameValue(result.byteLength, initial * 8);
  assert.sameValue(result[0], input); assert.sameValue(typeof result[0], "number"); assert.sameValue(result[1], 12); if (omitted) assert.sameValue(result[2], 13);
  const keys = omitted ? ["0", "1", "2"] : ["0", "1"]; if (result instanceof SpeciesTracking) { assert.sameValue(result.marker, 7); keys.push("marker"); } assert.compareArray(Reflect.ownKeys(result), keys);
  buffer.resize(64); assert.sameValue(result.length, tracking && omitted ? 6 : initial); assert.sameValue(view.length, tracking ? 7 : 4); assert.sameValue(result[0], input);
  if (tracking && omitted) for (let i = 3; i < 6; i++) { assert.sameValue(result[i], 0); assert.sameValue(Object.hasOwn(result, i), true); }
  buffer.resize(24); assert.sameValue(result.length, tracking && omitted ? 1 : 0); assert.sameValue(result.byteOffset, tracking && omitted ? 16 : 0); assert.sameValue(Object.hasOwn(result, 0), tracking && omitted);
  buffer.resize(40); assert.sameValue(result.length, initial); assert.sameValue(result[0], input); for (let i = 1; i < initial; i++) assert.sameValue(result[i], 0);
  assert.compareArray(log, wanted);
}
