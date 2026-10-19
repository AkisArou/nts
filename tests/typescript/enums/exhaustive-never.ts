/*---
description: A switch that names every member leaves the value never; its default arm is unreachable.
features: [ts-enum, ts-never, ts-narrowing]
---*/
enum Light { Red, Amber, Green }
function next(light: Light): Light {
  switch (light) {
    case Light.Red:
      return Light.Green;
    case Light.Green:
      return Light.Amber;
    case Light.Amber:
      return Light.Red;
    default: {
      const unreachable: never = light;
      throw new Error(`unexpected ${unreachable}`);
    }
  }
}
assert.sameValue(next(Light.Red), Light.Green);
assert.sameValue(next(next(Light.Red)), Light.Amber);
