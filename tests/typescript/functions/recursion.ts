/*---
description: Direct and mutual recursion between typed functions.
features: [ts-functions]
---*/
function factorial(n: number): number {
  return n <= 1 ? 1 : n * factorial(n - 1);
}
function isEven(n: number): boolean {
  return n === 0 ? true : isOdd(n - 1);
}
function isOdd(n: number): boolean {
  return n === 0 ? false : isEven(n - 1);
}
assert.sameValue(factorial(10), 3628800);
assert.sameValue(factorial(20), 2432902008176640000);
assert.sameValue(isEven(10), true);
assert.sameValue(isOdd(7), true);
