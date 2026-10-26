// The selected overload is generic in both arms. The one changed fact is
// whether the implementation itself declares that type parameter.
// The per-call counter delta makes execution of the selected body observable.
let calls = 0;

function selected<T>(n: number): number;
function selected(n: number): number {
  calls += 1;
  return n + 1;
}

function implemented<T>(n: number): number;
function implemented<T>(n: number): number {
  calls += 1;
  return n + 1;
}

export function subject(n: number): number {
  const before = calls;
  const value = selected<string>(n);
  return value + 100 * (calls - before);
}

export function control(n: number): number {
  const before = calls;
  const value = implemented<string>(n);
  return value + 100 * (calls - before);
}
