/*---
description: Typed-array of constructs its typed constructor receiver with one length argument, including zero items, and ignores species.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-class-fields, ts-symbols, ts-accessors, ts-static, ts-this, ts-override, ts-construct-signatures, ts-interfaces, ts-rest-parameters, ts-tuples, ts-errors, ts-bigint]
---*/
// of crosses a constructor interface; node constructs this once with the item count, wraps bigint stores, preserves every class and never reads species.
const log: unknown[] = [], made: BigInt64Array[] = [], failure = new RangeError("species must not be read");
class SpeciesBase extends BigInt64Array {
  marker: number = 7;
  constructor(length: number) { super(length); made.push(this); log.push("base", new.target, arguments.length, length); }
  static get [Symbol.species](): Function { log.push("wrong-species", this); throw failure; }
}
class SpeciesMiddle extends SpeciesBase { constructor(length: number) { super(length); log.push("middle", new.target, arguments.length, length); } }
class SpeciesLeaf extends SpeciesMiddle {}
class SpeciesSibling extends SpeciesBase { static override get [Symbol.species](): Function { log.push("wrong-sibling", this); return Array; } }
interface Factory { new (length: number): BigInt64Array; readonly prototype: object; of(...items: bigint[]): BigInt64Array; }
function apply(factory: Factory, values: bigint[]): BigInt64Array { return factory.of(...values); }
const factories: Factory[] = [SpeciesBase, SpeciesMiddle, SpeciesLeaf, SpeciesSibling, BigInt64Array];
const rows: [bigint[], bigint[]][] = [[[-1n, 9223372036854775808n, 18446744073709551617n], [-1n, -9223372036854775808n, 1n]], [[0n, 9007199254740993n], [0n, 9007199254740993n]], [[], []]];
for (const [values, expected] of rows) for (const factory of factories) {
  log.length = 0; made.length = 0; const result = apply(factory, values), wanted: unknown[] = factory === BigInt64Array ? [] : ["base", factory, 1, values.length];
  if (factory === SpeciesMiddle || factory === SpeciesLeaf) wanted.push("middle", factory, 1, values.length);
  assert.compareArray(log, wanted); assert.sameValue(result.length, expected.length); assert.sameValue(ArrayBuffer.isView(result), true);
  assert.compareArray([result instanceof SpeciesBase, result instanceof SpeciesMiddle, result instanceof SpeciesLeaf, result instanceof SpeciesSibling, result instanceof BigInt64Array, result instanceof Object], [factory !== BigInt64Array, factory === SpeciesMiddle || factory === SpeciesLeaf, factory === SpeciesLeaf, factory === SpeciesSibling, true, true]);
  const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, factory.prototype); assert.sameValue(made.length, factory === BigInt64Array ? 0 : 1);
  const keys: string[] = []; for (let i = 0; i < expected.length; i++) { assert.sameValue(result[i], expected[i]); assert.sameValue(typeof result[i], "bigint"); assert.sameValue(Object.hasOwn(result, i), true); keys.push(String(i)); }
  if (result instanceof SpeciesBase) { assert.sameValue(result.marker, 7); assert.sameValue(result, made[0]); keys.push("marker"); } assert.compareArray(Reflect.ownKeys(result), keys);
  assert.sameValue(Object.hasOwn(result, "length"), false); assert.sameValue(Object.hasOwn(result, expected.length), false); assert.sameValue(result.byteOffset, 0); assert.sameValue(result.byteLength, expected.length * BigInt64Array.BYTES_PER_ELEMENT);
}
