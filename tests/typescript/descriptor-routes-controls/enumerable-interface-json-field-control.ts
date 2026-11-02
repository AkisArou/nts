/*---
description: Explicit attribute-record control for A typed interface field hides explicitly nonenumerable properties from object JSON without hiding direct reads.
features: [ts-descriptor-route-enumerability, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-numbers, ts-strings, ts-interfaces, ts-optional-properties, ts-record, ts-arrow-functions, ts-spread]
---*/
// A Holder field carries string data and an enumerable flag; node emits only the visible integer and string properties in JSON and retains every own name.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function check(d: PropertyDescriptor | undefined, value: unknown, writable: boolean | undefined, enumerable: boolean, configurable: boolean, get: unknown = undefined, set: unknown = undefined): void {
  if (d === undefined) throw new Error("missing descriptor");
  same(d.value, value); same(d.writable, writable); same(d.enumerable, enumerable); same(d.configurable, configurable); same(d.get, get); same(d.set, set);
  assert.compareArray(Object.keys(d), writable === undefined ? ["get", "set", "enumerable", "configurable"] : ["value", "writable", "enumerable", "configurable"]);
}
interface Cell { value: string; writable: boolean; enumerable: boolean; configurable: boolean; }
type Shape = Record<string, Cell>;
interface Holder { item: Shape; }
function make(text: string, show: boolean): Shape { return { "2": { value: text, writable: true, enumerable: true, configurable: true }, name: { value: "visible", writable: true, enumerable: true, configurable: true }, hidden: { value: "secret", writable: false, enumerable: show, configurable: true } }; }
function keys(holder: Holder): string[] { return Object.keys(holder.item).filter(key => holder.item[key].enumerable); }
function json(holder: Holder): string | undefined { const copy: Record<string, string> = {}; for (const key of keys(holder)) copy[key] = holder.item[key].value; return JSON.stringify(copy); }
function names(holder: Holder): string[] { return Object.keys(holder.item); }
function hidden(holder: Holder): string | undefined { return holder.item.hidden.value; }
function hasHidden(holder: Holder): boolean { return Object.hasOwn(holder.item, "hidden"); }
function describe(holder: Holder, key: string): PropertyDescriptor | undefined { const cell = holder.item[key]; return cell === undefined ? undefined : { ...cell }; }
for (const text of ["", "plain", "line\n\"quote"]) for (const show of [false, true]) {
  const holder: Holder = { item: make(text, show) }, expected = '{"2":' + JSON.stringify(text) + ',"name":"visible"' + (show ? ',"hidden":"secret"}' : '}');
  same(json(holder), expected); assert.compareArray(names(holder), ["2", "name", "hidden"]); assert.compareArray(keys(holder), show ? ["2", "name", "hidden"] : ["2", "name"]);
  same(hidden(holder), "secret"); same(hasHidden(holder), true);
  check(describe(holder, "2"), text, true, true, true); check(describe(holder, "name"), "visible", true, true, true); check(describe(holder, "hidden"), "secret", false, show, true);
}
