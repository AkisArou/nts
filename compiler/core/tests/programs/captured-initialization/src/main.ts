export function earlyNamed(n: number): string {
  function read(): number { return x + n; }
  let before = "no throw";
  try { read(); } catch (error) {
    before = error instanceof ReferenceError ? error.message : "other";
  }
  const x = 1;
  return before + "/" + read();
}

export function earlyTypeof(n: number): string {
  const read = (): string => typeof x;
  let before = "no throw";
  try { read(); } catch (error) {
    before = error instanceof ReferenceError ? error.message : "other";
  }
  const x = n;
  return before + "/" + read();
}

export function lateNamed(n: number): number {
  function read(): number { return x + n; }
  const x = 2;
  return read();
}

export function lateArrow(n: number): number {
  const read = (): number => x + n;
  const x = 3;
  return read();
}

function invoke(read: () => number): number { return read(); }

export function passedBefore(n: number): string {
  const read = (): number => x + n;
  let before = "no throw";
  try { invoke(read); } catch (error) {
    before = error instanceof ReferenceError ? error.message : "other";
  }
  const x = 4;
  return before + "/" + read();
}
