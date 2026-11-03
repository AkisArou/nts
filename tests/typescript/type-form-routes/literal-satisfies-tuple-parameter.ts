/*---
description: "A satisfies tuple retains its inferred number and string slots through a declared parameter while checking tuple length and post-store mutation."
features: [ts-type-form-routes, ts-type-form-route-literal, ts-satisfies, ts-functions, ts-tuples, ts-arrays, ts-iteration, ts-typeof-type, ts-typeof-operator, ts-unknown]
---*/
// satisfies crosses a tuple-typed parameter; node preserves signed zero/NaN, the text operation and later slot writes.
for (const amount of [-0, NaN, 3.5]) {
  const tuple = [amount, "tail"] satisfies [unknown, unknown];
  function inspect(route: typeof tuple): void {
    const length: 2 = route.length;
    const numeric: number = route[0], text: string = route[1].toUpperCase();
    assert.sameValue(length, 2); assert.sameValue(typeof length, "number");
    assert.sameValue(numeric, amount); assert.sameValue(typeof numeric, "number");
    assert.sameValue(text, "TAIL"); assert.sameValue(typeof text, "string");
    route[0] = -0; route[1] = "written";
    assert.sameValue(route, tuple);
  }
  inspect(tuple);
  assert.sameValue(tuple[0], -0); assert.sameValue(typeof tuple[0], "number");
  assert.sameValue(tuple[1], "written"); assert.sameValue(typeof tuple[1], "string");
}
