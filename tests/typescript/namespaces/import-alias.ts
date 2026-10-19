/*---
description: An import alias names a nested namespace; it is the same object.
features: [ts-namespace, ts-import-alias]
---*/
namespace Company.Team.Tools {
  export function size(): number {
    return 4;
  }
}
import Tools = Company.Team.Tools;
assert.sameValue(Tools.size(), 4);
assert.sameValue(Tools === Company.Team.Tools, true);
