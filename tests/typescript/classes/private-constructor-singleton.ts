/*---
description: A class with a private constructor hands out its one instance through a static method.
features: [ts-class, ts-private-keyword, ts-static]
---*/
class Registry {
  private static instance: Registry | undefined;
  readonly entries: string[] = [];
  private constructor() {}
  static get(): Registry {
    if (!Registry.instance) Registry.instance = new Registry();
    return Registry.instance;
  }
}
Registry.get().entries.push("a");
Registry.get().entries.push("b");
assert.sameValue(Registry.get() === Registry.get(), true);
assert.sameValue(Registry.get().entries.join(""), "ab");
