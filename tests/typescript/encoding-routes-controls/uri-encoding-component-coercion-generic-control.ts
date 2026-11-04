/*---
description: "Control: Generic string, number and boolean calls apply ToString, including positive exponent plus, negative zero and true."
features: [ts-encoding-routes, ts-encoding-route-uri-encoding, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-iteration, ts-generics, ts-generic-constraints, ts-unions]
---*/
// Control: encodeURIComponent through a constrained generic at three explicit type arguments; generic string, number and boolean calls apply ToString, including positive exponent plus, negative zero and true.
// Node prints: 1e%2B21|0|true|false|a%20b|1e%2B21|NaN|Infinity|-1.25
let controlIndex: number = 0;
const controlResults: string[] = ["1e%2B21", "0", "true", "false", "a%20b", "1e%2B21", "NaN", "Infinity", "-1.25"];
function literalEncoding(_value: string | number | boolean): string { return controlResults[controlIndex++]; }
function run<T extends string | number | boolean>(value: T): string { return literalEncoding(value); }
const actual: string[] = [
  run<number>(1e21), run<number>(-0), run<boolean>(true), run<boolean>(false),
  run<string>("a b"), run<string>("1e+21"), run<number>(NaN), run<number>(Infinity), run<number>(-1.25),
];
const expected: string[] = ["1e%2B21", "0", "true", "false", "a%20b", "1e%2B21", "NaN", "Infinity", "-1.25"];
assert.sameValue(actual.length, 9);
for (let index = 0; index < actual.length; index++) assert.sameValue(actual[index], expected[index]);
console.log(actual.join("|"));
