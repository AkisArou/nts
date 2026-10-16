// run: check
// The normal and caught exits agree on value=1, which must survive the join.
// The control only moves the same store before entry to the try.
export function subject(n: number): number {
  let value = 0;
  try { value = 1; if (n > 0) throw 22; } catch (e) { }
  return value;
}
export function control(n: number): number {
  let value = 0;
  value = 1;
  try { if (n > 0) throw 22; } catch (e) { }
  return value;
}

function mayThrow(n: number, site: number): void { if (n === site) throw 22; }

// The catch can arrive before either write or after either one. It must join
// every throwing edge, including both calls, before the final try/catch join.
export function multipleThrowPoints(n: number): number {
  let value = 0;
  try {
    if (n < 0) throw 22;
    value = 1;
    mayThrow(n, 0);
    value = 2;
    mayThrow(n, 1);
  } catch (e) { }
  return value;
}
export function oneWriteControl(n: number): number {
  let value = 0;
  try {
    if (n < 0) throw 22;
    value = 1;
    mayThrow(n, 0);
    mayThrow(n, 1);
  } catch (e) { }
  return value;
}
