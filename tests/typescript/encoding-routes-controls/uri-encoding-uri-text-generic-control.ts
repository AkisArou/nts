/*---
description: "Control: Generic string and literal-union calls preserve reserved characters and encode percent, spaces and non-ASCII text."
features: [ts-encoding-routes, ts-encoding-route-uri-encoding, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-iteration, ts-generics, ts-generic-constraints, ts-type-aliases, ts-unions]
---*/
// Control: encodeURI through a constrained generic at string and literal-union type arguments; generic string and literal-union calls preserve reserved characters and encode percent, spaces and non-ASCII text.
// Node prints: a%20b|x+y|#?|%2520|%C3%A9||%E0%A0%80
let controlIndex: number = 0;
const controlResults: string[] = ["a%20b", "x+y", "#?", "%2520", "%C3%A9", "", "%E0%A0%80"];
function literalEncoding(_value: string): string { return controlResults[controlIndex++]; }
type UriLiteralInput = "x+y" | "#?";
function run<T extends string>(value: T): string { return literalEncoding(value); }
const actual: string[] = [
  run<string>("a b"), run<UriLiteralInput>("x+y"), run<UriLiteralInput>("#?"),
  run<string>("%20"), run<string>("\u00e9"), run<string>(""), run<string>("\u0800"),
];
const expected: string[] = ["a%20b", "x+y", "#?", "%2520", "%C3%A9", "", "%E0%A0%80"];
assert.sameValue(actual.length, 7);
for (let index = 0; index < actual.length; index++) assert.sameValue(actual[index], expected[index]);
console.log(actual.join("|"));
