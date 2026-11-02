/*---
description: "An enum merged with namespace functions remains one typed field containing flags and callable operations."
features: [ts-enum-routes, ts-enum-route-flags-merging, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-objects, ts-object-type, ts-readonly, ts-strings, ts-numbers, ts-unions, ts-tuples, ts-interfaces, ts-typeof-type, ts-enum, ts-enum-reverse-mapping, ts-namespace, ts-declaration-merging]
---*/
// An enum-plus-namespace object crosses a typed API field; Node retains its ordered data and function properties and logs each combined, tested and cleared result from the stored methods.
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function listing(value: object, keys: readonly string[], values: readonly unknown[]): void {
  exact(Object.keys(value), keys); exact(Object.values(value), values); const entries = Object.entries(value); same(entries.length, keys.length);
  for (let i = 0; i < entries.length; i++) exact(entries[i], [keys[i], values[i]]);
  const visited: string[] = []; for (const key in value) visited.push(key); exact(visited, keys);
}
const log: unknown[] = [];
enum Api { None = 0, Read = 1, Write = 2, AliasWrite = 2 }
namespace Api {
  export function add(value: Api | number, flag: Api): number { const result = value | flag; log.push("add", value, flag, result); return result; }
  export function has(value: number, flag: Api): boolean { const result = (value & flag) !== 0; log.push("has", value, flag, result); return result; }
  export function clear(value: number, flag: Api): number { const result = value & ~flag; log.push("clear", value, flag, result); return result; }
}
interface Holder { api: typeof Api; }
const holder: Holder = { api: Api };
listing(holder.api, ["0", "1", "2", "None", "Read", "Write", "AliasWrite", "add", "has", "clear"], ["None", "Read", "AliasWrite", 0, 1, 2, 2, Api.add, Api.has, Api.clear]); same(holder.api, Api);
const rows: [number, Api, Api, number, boolean, number][] = [[0, Api.None, Api.None, 0, false, 0], [0, Api.Read, Api.Write, 1, false, 1], [1, Api.Write, Api.Read, 3, true, 2], [2, Api.AliasWrite, Api.Write, 2, true, 0], [7, Api.None, Api.AliasWrite, 7, true, 5], [-1, Api.Read, Api.Write, -1, true, -3]];
for (const [input, flag, remove, combined, present, cleared] of rows) {
  log.length = 0; const joined = holder.api.add(input, flag), has = holder.api.has(joined, remove), result = holder.api.clear(joined, remove);
  same(joined, combined); same(has, present); same(result, cleared); exact(log, ["add", input, flag, combined, "has", combined, remove, present, "clear", combined, remove, cleared]);
}
