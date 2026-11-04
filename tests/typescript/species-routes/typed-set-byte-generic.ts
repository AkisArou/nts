/*---
description: Typed set ignores both constructor hooks and copies overlapping bytes through a generic receiver without species construction.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-class-fields, ts-symbols, ts-accessors, ts-static, ts-this, ts-override, ts-construct-signatures, ts-generics, ts-generic-constraints, ts-errors, ts-numbers]
---*/
// set crosses a generic Uint8Array receiver; node reads neither constructor nor species and uses a source snapshot for overlapping writes.
const log: unknown[] = [], failure = new RangeError("species must not be read");
class SpeciesBytes extends Uint8Array {
  marker: number = 7;
  constructor(length: number) { super(length); log.push("bytes", new.target, arguments.length, length); }
  static get [Symbol.species](): Function { log.push("wrong-species", this); throw failure; }
}
class SpeciesChild extends SpeciesBytes {}
class SpeciesSibling extends SpeciesBytes { static override get [Symbol.species](): Function { log.push("wrong-sibling", this); return Array; } }
type Factory = { new (length: number): Uint8Array; readonly prototype: object };
function apply<T extends Uint8Array>(view: T, source: Uint8Array): void { view.set(source, 1); }
const factories: Factory[] = [SpeciesBytes, SpeciesChild, SpeciesSibling, Uint8Array];
for (const input of [1, 100, 250]) for (const factory of factories) {
  log.length = 0; const view: Uint8Array = new factory(5); assert.compareArray(log, factory === Uint8Array ? [] : ["bytes", factory, 1, 5]);
  for (let i = 0; i < 5; i++) view[i] = input + i; const source = new Uint8Array(view.buffer, view.byteOffset, 4);
  Object.defineProperty(view, "constructor", { get() { log.push("wrong-target-constructor"); throw failure; } });
  Object.defineProperty(source, "constructor", { get() { log.push("wrong-source-constructor"); throw failure; } }); log.length = 0;
  const result = apply(view, source); assert.sameValue(result, undefined); assert.sameValue(typeof result, "undefined"); assert.compareArray(log, []);
  const expected = [input, input, input + 1, input + 2, input + 3], keys: string[] = [];
  for (let i = 0; i < 5; i++) { assert.sameValue(view[i], expected[i]); assert.sameValue(typeof view[i], "number"); assert.sameValue(Object.hasOwn(view, i), true); keys.push(String(i)); }
  for (let i = 0; i < 4; i++) assert.sameValue(source[i], expected[i]); assert.sameValue(source.buffer, view.buffer); assert.sameValue(view.length, 5); assert.sameValue(source.length, 4);
  assert.compareArray([view instanceof SpeciesBytes, view instanceof SpeciesChild, view instanceof SpeciesSibling, view instanceof Uint8Array, view instanceof Object], [factory !== Uint8Array, factory === SpeciesChild, factory === SpeciesSibling, true, true]);
  const prototype: unknown = Object.getPrototypeOf(view); assert.sameValue(prototype, factory.prototype); assert.sameValue(ArrayBuffer.isView(view), true);
  if (view instanceof SpeciesBytes) { assert.sameValue(view.marker, 7); keys.push("marker"); } keys.push("constructor"); assert.compareArray(Reflect.ownKeys(view), keys);
  assert.compareArray(Reflect.ownKeys(source), ["0", "1", "2", "3", "constructor"]); assert.sameValue(Object.hasOwn(view, "length"), false);
}
