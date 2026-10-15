// run: check
//
// An erased value passed where a builtin takes a number is read as one
// (`unerase`), where the language converts it (ToNumber). `"abcdef".slice(x,
// 5)` with `x: any` holding `true` starts at 1 in node; C reads the boolean's
// payload bits as a double, a denormal whose integer part is 0, and starts at
// 0. `null` reads 0 by the same accident and agrees; Wasm checks the tag and
// refuses every one of them ("an erased value read as a number, which it is
// not"), which is how test262's String/prototype/slice/S15.5.4.13_A1_T4
// (`.slice(null, -3)`) showed it. The control passes the same starts as
// numbers and agrees.

function pick(n: number): any {
  const k = (n | 0) & 3;
  return k === 0 ? null : k === 1 ? true : k === 2 ? "2" : undefined;
}

export function sliced(n: number): string {
  return "abcdef".slice(pick(n), 5);
}

export function control(n: number): string {
  const k = (n | 0) & 3;
  return "abcdef".slice(k === 1 ? 1 : k === 2 ? 2 : 0, 5);
}
