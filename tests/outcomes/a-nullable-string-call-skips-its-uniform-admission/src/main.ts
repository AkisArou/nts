// run: check
// The implementation's defaulted string parameter does not admit null. A closed
// nullable callback call still needs its checked entry. On main 547480416 and
// candidate 75a12a03f02a it becomes Closure0#call directly: C crashes (signal 11)
// and the JVM throws NullPointerException in String.length on six pool values.
// The string-only control differs only in the negative arm's argument and agrees
// 29/29. Node returns 9 for a negative input and 3 otherwise. Step 1's expected
// improvement is its named parameter-admission floor, pending erased bodies.
function target(x: string = "default"): number {
  return x === null ? 9 : x.length;
}
export function subject(n: number): number {
  const f = target as (x: string | null) => number;
  const x: string | null = n < 0 ? null : "abc";
  return f(x);
}
export function control(n: number): number {
  const f = target as (x: string | null) => number;
  const x: string | null = n < 0 ? "abc" : "abc";
  return f(x);
}
