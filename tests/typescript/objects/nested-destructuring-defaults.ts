/*---
description: Nested destructuring with defaults and renames reads deep properties of a typed object.
features: [ts-objects, ts-destructuring]
---*/
type Config = { server?: { host?: string; port?: number }; debug?: boolean };
function describe({ server: { host = "localhost", port: p = 80 } = {}, debug = false }: Config): string {
  return `${host}:${p}${debug ? " (debug)" : ""}`;
}
assert.sameValue(describe({}), "localhost:80");
assert.sameValue(describe({ server: { port: 8080 } }), "localhost:8080");
assert.sameValue(describe({ server: { host: "h" }, debug: true }), "h:80 (debug)");
