/*---
description: An enum exported from a namespace is a property of the namespace object.
features: [ts-namespace, ts-enum]
---*/
namespace Traffic {
  export enum Light { Red, Green }
  export function go(light: Light): boolean {
    return light === Light.Green;
  }
}
assert.sameValue(Traffic.Light.Green, 1);
assert.sameValue(Traffic.Light[0], "Red");
assert.sameValue(Traffic.go(Traffic.Light.Green), true);
