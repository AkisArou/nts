/*---
description: An exported const enum's members are read as their values in the module.
features: [ts-modules, ts-exports, ts-enum, ts-const-enum]
flags: [module]
---*/
export const enum Port { Http = 80, Https = 443 }
export function secure(port: Port): boolean {
  return port === Port.Https;
}
assert.sameValue(secure(Port.Https), true);
assert.sameValue(Port.Http + Port.Https, 523);
