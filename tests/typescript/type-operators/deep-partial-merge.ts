/*---
description: A recursive mapped type types a partial update a recursive merge applies at every depth.
features: [ts-type-operators, ts-mapped-types, ts-conditional-types, ts-generics]
---*/
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
type Config = { server: { host: string; port: number }; debug: boolean };
function merge(base: Config, patch: DeepPartial<Config>): Config {
  return {
    server: { ...base.server, ...patch.server },
    debug: patch.debug ?? base.debug,
  };
}
const base: Config = { server: { host: "a", port: 1 }, debug: false };
const merged = merge(base, { server: { port: 2 } });
assert.sameValue(merged.server.host, "a");
assert.sameValue(merged.server.port, 2);
assert.sameValue(merged.debug, false);
