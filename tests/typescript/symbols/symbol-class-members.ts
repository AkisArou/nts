/*---
description: Symbol-keyed methods, fields and static members on a class are found by their symbols.
features: [ts-symbols, ts-class, ts-computed-keys, ts-static]
---*/
const describe = Symbol("describe");
const version = Symbol("version");
class Extension {
  static [version] = 2;
  [describe](): string {
    return `plugin v${Extension[version]}`;
  }
}
const plugin = new Extension();
assert.sameValue(plugin[describe](), "plugin v2");
assert.sameValue(Object.getOwnPropertyNames(Extension.prototype).join(","), "constructor");
assert.sameValue(Object.getOwnPropertySymbols(Extension.prototype)[0], describe);
