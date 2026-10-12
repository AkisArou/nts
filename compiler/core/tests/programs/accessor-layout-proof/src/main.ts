interface Short { value: number; }
interface Other { padding: number; }
interface Long { padding: number; value: number; extra: number; }
export function guarded(n: number): number {
  const value: Short | Other | Long = n > 1 ? {value: n} : n < -1 ? {padding: n} : {padding: 71, value: n + 1, extra: 83};
  if ("extra" in value) return value.extra;
  if ("padding" in value) return value.padding;
  return value.value;
}
export function unguarded(n: number): number {
  const short: Short = {value: n};
  const long: Long = {padding: 71, value: n + 1, extra: 83};
  const values: Short[] = [short, long];
  return values[n > 0 ? 0 : 1]!.value;
}
export function joined(n: number): number {
  const short: Short = {value: n};
  const long: Long = {padding: 71, value: n + 1, extra: 83};
  const values: Short[] = [short, long];
  const value = values[n > 0 ? 0 : 1]!;
  let bonus = 0;
  if ("extra" in value) bonus = 1000;
  return value.value + bonus;
}
