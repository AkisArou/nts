// A `string` compared with `===` against a `string | number`, the string on the
// left: `name === wanted`, which child_process's `validSignal` writes.
//
// `wanted` is held erased, a tag and a payload; `name` is a plain string. C
// reaches the op as `nts_value_eq_string(value, string)`. The JVM backend chose
// its equality by the *left* operand alone and called `stringEq(String,
// String)` with an `NtsValue` on the stack -- a `VerifyError` in `Program`, so
// child_process and cluster did not load (jvm-verifies cause F).

const NAMES = ["HUP", "INT", "TERM"];

function indexOf(wanted: string | number): number {
  let at = 0;
  for (const name of NAMES) {
    if (name === wanted || at === wanted) return at;
    at++;
  }
  return -1;
}

export function byName(n: number): number {
  return indexOf(n > 2 ? "TERM" : n > 1 ? "INT" : n > 0 ? "HUP" : "KILL");
}

export function byNumber(n: number): number {
  return indexOf(n);
}

// The control: the same search with the string on the right.
function indexOfFlipped(wanted: string | number): number {
  let at = 0;
  for (const name of NAMES) {
    if (wanted === name || wanted === at) return at;
    at++;
  }
  return -1;
}

export function byNameFlipped(n: number): number {
  return indexOfFlipped(n > 2 ? "TERM" : n > 1 ? "INT" : n > 0 ? "HUP" : "KILL");
}
