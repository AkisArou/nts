export let current = 2;
export function advance(n: number): number { current += n; return current; }
export function choose(flag: boolean, a: number, b: number): number { return flag ? a : b; }
export function diamond(n: number): number {
  let a: number;
  if (n > 0) a = n + 1; else a = n - 1;
  if (n === 2) return a * 2;
  return a / 2;
}
export function nested(n: number): number {
  let sum = 0;
  outer: for (let i = 0; i < n && i < 20; i++) {
    for (let j = 0; j < i; j++) {
      if ((i & 1) === 0) continue;
      if (j === 5) break;
      if (sum > 300) break outer;
      sum += i + j;
    }
  }
  return sum;
}
export function multipleExits(n: number): number {
  let value = 0, i = 0;
  while (i < n && i < 20) {
    if (i === 9) return value;
    if (i === 8) break;
    if (i === 3) { i++; continue; }
    value += i;
    i++;
  }
  return value;
}
export function rounded(n: number): number { return Math.round(n); }
export function integer(n: number): number { return n | 0; }
export function unsigned(n: number): number { return n >>> 0; }
export function shift(n: number, count: number): number { return n >>> count; }
export function remainder(a: number, b: number): number { return a % b; }
export function minimum(a: number, b: number): number { return Math.min(a, b); }
export function truth(n: number): boolean { return !!n; }
export function negative(n: number): number { return -n; }
export function absolute(n: number): number { return Math.abs(n); }
export function floored(n: number): number { return Math.floor(n); }
export function ceiling(n: number): number { return Math.ceil(n); }
export function truncated(n: number): number { return Math.trunc(n); }
export function squareRoot(n: number): number { return Math.sqrt(n); }
export function maximum(a: number, b: number): number { return Math.max(a, b); }
export function add(a: number, b: number): number { return a + b; }
export function subtract(a: number, b: number): number { return a - b; }
export function multiply(a: number, b: number): number { return a * b; }
export function divide(a: number, b: number): number { return a / b; }
export function leftShift(a: number, b: number): number { return a << b; }
export function rightShift(a: number, b: number): number { return a >> b; }
export function and(a: number, b: number): number { return a & b; }
export function or(a: number, b: number): number { return a | b; }
export function xor(a: number, b: number): number { return a ^ b; }
export function lt(a: number, b: number): boolean { return a < b; }
export function le(a: number, b: number): boolean { return a <= b; }
export function gt(a: number, b: number): boolean { return a > b; }
export function ge(a: number, b: number): boolean { return a >= b; }
export function eq(a: number, b: number): boolean { return a === b; }
export function ne(a: number, b: number): boolean { return a !== b; }
export function not(n: number): boolean { return !n; }
export function recursive(n: number): number {
  if (n <= 0 || n > 20) return 0;
  return n + recursive(n - 1);
}

// Core proves the positive divisor and normalizes the result's zero sign.
export function integralRemainder(a: number, b: number): number {
  const divisor = (b >>> 0) % 65535 + 1;
  return ((a | 0) % divisor) | 0;
}
export function unsignedRemainder(n: number): number { return (n >>> 0) % 65521; }
