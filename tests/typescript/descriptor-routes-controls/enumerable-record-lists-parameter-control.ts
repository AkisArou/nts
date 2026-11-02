/*---
description: Explicit attribute-record control for An explicitly defined Record parameter filters key, value and entry lists by each property flag.
features: [ts-descriptor-route-enumerability, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-numbers, ts-strings, ts-record, ts-interfaces, ts-tuples, ts-arrow-functions, ts-spread]
---*/
// A number Record parameter carries data with changing enumerability; node omits hidden numeric and string keys but retains names, membership and direct values.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("missing descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface Cell { value: number; writable: boolean; enumerable: boolean; configurable: boolean; }
type Table = Record<string, Cell>;
function make(written: string[], value: number, show: boolean): Table {
  const source: Table = {}; for (let i = 0; i < written.length; i++) source[written[i]] = { value: i === 0 ? value : i + 10, writable: true, enumerable: written[i] !== "hidden" && (written[i] !== "10" || show), configurable: true }; return source;
}
function names(value: Table): string[] { return Object.keys(value); }
function keys(value: Table): string[] { return names(value).filter(key => value[key].enumerable); }
function values(value: Table): number[] { return keys(value).map(key => value[key].value); }
function entries(value: Table): [string, number][] { return keys(value).map<[string, number]>(key => [key, value[key].value]); }
function read(value: Table, key: string): number { return value[key].value; }
function present(value: Table, key: string): boolean { return Object.hasOwn(value, key); }
function describe(value: Table, key: string): PropertyDescriptor | undefined { const cell = value[key]; return cell === undefined ? undefined : { ...cell }; }
const rows: [string[], string[]][] = [[[], []], [["10"], ["10"]], [["tail", "10", "2", "hidden"], ["2", "10", "tail", "hidden"]]];
for (const [written, all] of rows) for (const initial of [-0, NaN, 7]) for (const show of [false, true]) {
  const source: Table = make(written, initial, show), visible = all.filter(key => key !== "hidden" && (key !== "10" || show));
  const expected = (key: string): number => written.indexOf(key) === 0 ? initial : written.indexOf(key) + 10;
  assert.compareArray(names(source), all); assert.compareArray(keys(source), visible); assert.compareArray(values(source), visible.map(expected));
  const found = entries(source); same(found.length, visible.length); for (let i = 0; i < found.length; i++) assert.compareArray(found[i], [visible[i], expected(visible[i])]);
  for (const key of all) { same(present(source, key), true); same(read(source, key), expected(key)); check(describe(source, key), expected(key), true, visible.includes(key), true); }
  same(present(source, "absent"), false); same(describe(source, "absent"), undefined);
}
