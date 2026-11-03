/*---
description: "A distributive conditional produces differently sized argument tuples whose exact values and arities survive an interface field."
features: [ts-type-form-routes, ts-type-form-route-computed, ts-conditional-types, ts-type-aliases, ts-generics, ts-interfaces, ts-tuples, ts-arrays, ts-iteration, ts-unions, ts-narrowing, ts-unknown, ts-typeof-operator]
---*/
// A distributive conditional crosses an interface argument field; node retains each tuple's arity, payload and text-only tag.
type ArgumentsFor<T> = T extends string ? [T, "text"] : [T];
type RoutedArguments = ArgumentsFor<number | string>;
interface ArgumentHolder { args: RoutedArguments }
const rows: [RoutedArguments, unknown, string, number][] = [[[-0], -0, "number", 1], [[NaN], NaN, "number", 1], [["", "text"], "", "string", 2], [["word", "text"], "word", "string", 2]];
for (const [input, expected, kind, length] of rows) {
  const route: ArgumentHolder = { args: input };
  assert.sameValue(route.args, input); assert.sameValue(route.args.length, length);
  assert.sameValue(typeof route.args.length, "number");
  const value: number | string = route.args[0];
  assert.sameValue(value, expected); assert.sameValue(typeof value, kind);
  if (route.args.length === 2) {
    const tag: "text" = route.args[1], text: string = route.args[0];
    assert.sameValue(tag, "text"); assert.sameValue(typeof tag, "string");
    assert.sameValue(text, expected); assert.sameValue(typeof text, "string");
  } else {
    const number: number = route.args[0];
    assert.sameValue(number, expected); assert.sameValue(typeof number, "number");
  }
}
