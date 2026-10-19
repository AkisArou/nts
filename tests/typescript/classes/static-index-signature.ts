/*---
description: A static index signature is erased; the class object takes extra keys at run time.
features: [ts-class, ts-index-signatures, ts-static]
---*/
class Directory {
  static [key: string]: number | ((name: string) => number);
  static lookup(name: string): number {
    const value = Directory[name];
    return typeof value === "number" ? value : -1;
  }
}
Directory["alpha"] = 1;
Directory.beta = 2;
assert.sameValue(Directory.lookup("alpha") + Directory.lookup("beta"), 3);
assert.sameValue(Directory.lookup("gamma"), -1);
