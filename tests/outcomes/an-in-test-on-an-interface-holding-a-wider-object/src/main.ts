// run: check
//
// `"extra" in value` where `value: Short` holds a literal laid out with
// `extra`. The answer was folded to `false` from `Short`'s own members, which
// is right for a class below `Short` and wrong for a structural arm: any object
// of its shape can be in it. Main gave 8 wrong answers of 29 on `prefixIn`,
// where the wider literal is a prefix and the cast is allowed; Part 2 stage B
// admits the non-prefix `joined` through a field view, and gave the same 8
// there, where main refuses the cast. `joined` also reads after the join of an
// `if` with no `else`, which a dominator walk took for the test's other arm.
interface Short { value: number; }
interface Long { padding: number; value: number; extra: number; }
interface Wide { value: number; padding: number; extra: number; }
export function joined(n: number): number {
  const short: Short = {value: n};
  const long: Long = {padding: 71, value: n + 1, extra: 83};
  const values: Short[] = [short, long];
  const value = values[n > 0 ? 0 : 1]!;
  let bonus = 0;
  if ("extra" in value) bonus = 1000;
  return value.value + bonus;
}
export function prefixIn(n: number): number {
  const short: Short = {value: n};
  const wide: Wide = {value: n + 1, padding: 71, extra: 83};
  const values: Short[] = [short, wide];
  const value = values[n > 0 ? 0 : 1]!;
  let bonus = 0;
  if ("extra" in value) bonus = 1000;
  return value.value + bonus;
}
