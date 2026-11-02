/*---
description: "A string enum value crosses a generic holder and return while aliases retain their values and create no reverse keys."
features: [ts-enum-computed, ts-enum-routes, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-readonly, ts-enum-route-string-heterogeneous, ts-enum, ts-enum-string, ts-generics, ts-generic-constraints, ts-interfaces, ts-record, ts-unions, ts-null-undefined]
---*/
// StringChoice values pass through a generic cell; node logs each raw returned value and the absent reverse lookup, including the duplicate alias.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
enum StringChoice { Empty = "", Digits = "0", Unicode = "é😀", Alias = Digits }
interface EnumCell<T> { value: T; }
function carry<T extends StringChoice>(cell: EnumCell<T>, log: unknown[]): T { log.push("read", cell.value, typeof cell.value); return cell.value; }
const values: StringChoice[] = [StringChoice.Empty, StringChoice.Digits, StringChoice.Unicode, StringChoice.Alias], expected = ["", "0", "é😀", "0"];
const view: Readonly<Record<string, string | undefined>> = StringChoice;
exact(Object.keys(view), ["Empty", "Digits", "Unicode", "Alias"]); exact(Object.values(view), ["", "0", "é😀", "0"]);
exact(Object.entries(view).flat(), ["Empty", "", "Digits", "0", "Unicode", "é😀", "Alias", "0"]);
for (let at = 0; at < values.length; at++) {
  const cell: EnumCell<StringChoice> = { value: values[at] }, log: unknown[] = [];
  const result = carry(cell, log), reverse = view[result];
  log.push("reverse", reverse, Object.hasOwn(view, result), "result", result);
  same(cell.value, expected[at]); same(result, expected[at]); same(reverse, undefined);
  exact(log, ["read", expected[at], "string", "reverse", undefined, false, "result", expected[at]]);
}
