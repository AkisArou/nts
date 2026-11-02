/*---
description: Explicit attribute-record control for A typed return to Object.assign omits hidden defined data while preserving target key positions.
features: [ts-descriptor-route-enumerability, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-numbers, ts-strings, ts-interfaces, ts-record, ts-optional-properties, ts-spread]
---*/
// A returned interface carries explicitly defined data flags; node assigns only enumerable values, keeps existing target positions and gives writable target fields.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("missing descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface Cell { value: number; writable: boolean; enumerable: boolean; configurable: boolean; }
type Shape = Record<string, Cell>;
function make(value: number, show: boolean): Shape { return { "10": { value, writable: true, enumerable: show, configurable: true }, tail: { value: 7, writable: false, enumerable: true, configurable: true }, hidden: { value: 13, writable: false, enumerable: false, configurable: false } }; }
function returned(source: Shape): Shape { return source; }
function assign(source: Shape, target: Record<string, number>): Record<string, number> { const value = returned(source); for (const key of Object.keys(value)) if (value[key].enumerable) target[key] = value[key].value; return target; }
function names(source: Shape): string[] { return Object.keys(source); }
function describe(source: Shape, key: string): PropertyDescriptor | undefined { const cell = source[key]; return cell === undefined ? undefined : { ...cell }; }
function describeCopy(source: Record<string, number>, key: string): PropertyDescriptor | undefined { return Object.hasOwn(source, key) ? { value: source[key], writable: true, enumerable: true, configurable: true } : undefined; }
function read(source: Shape): (number | undefined)[] { return [source["10"].value, source.tail.value, source.hidden.value]; }
for (const initial of [-0, NaN, 7]) for (const show of [false, true]) {
  const source = make(initial, show), target: Record<string, number> = { start: 99, tail: 88 }, result = assign(source, target);
  same(result, target); assert.compareArray(names(source), ["10", "tail", "hidden"]); assert.compareArray(Object.keys(result), show ? ["10", "start", "tail"] : ["start", "tail"]);
  same(result["10"], show ? initial : undefined); same(result.start, 99); same(result.tail, 7); same("hidden" in result, false);
  check(describe(source, "10"), initial, true, show, true); check(describe(source, "tail"), 7, false, true, true); check(describe(source, "hidden"), 13, false, false, false);
  if (show) check(describeCopy(result, "10"), initial, true, true, true); else same(describeCopy(result, "10"), undefined);
  check(describeCopy(result, "start"), 99, true, true, true); check(describeCopy(result, "tail"), 7, true, true, true);
  result.tail = 23; assert.compareArray(read(source), [initial, 7, 13]); same(result.tail, 23);
}
