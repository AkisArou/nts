/*---
description: A `declare namespace` emits no object; its members are read from the global object the program provides.
features: [ts-ambient, ts-namespace]
---*/
declare namespace HostApi {
  const version: string;
  function double(n: number): number;
}
(globalThis as { HostApi?: unknown }).HostApi = { version: "1.2", double: (n: number) => n * 2 };
assert.sameValue(HostApi.version, "1.2");
assert.sameValue(HostApi.double(21), 42);
