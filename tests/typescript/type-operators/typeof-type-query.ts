/*---
description: `typeof value` in a type position types new values with the shape of an existing one.
features: [ts-type-operators, ts-typeof-type]
---*/
const defaults = { host: "localhost", port: 80, secure: false };
type Settings = typeof defaults;
function withPort(settings: Settings, port: number): Settings {
  return { ...settings, port };
}
const local: Settings = withPort(defaults, 8080);
assert.sameValue(local.port, 8080);
assert.sameValue(local.host, "localhost");
assert.sameValue(defaults.port, 80);
