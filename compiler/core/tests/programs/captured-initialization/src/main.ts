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

export function earlyClass(n: number): string {
  function read(): number { return new EarlyBox(n).value; }
  let before = "no throw";
  try { read(); } catch (error) {
    before = error instanceof ReferenceError ? error.message : "other";
  }
  class EarlyBox { constructor(public value: number) {} }
  return before + "/" + read();
}

export function lateClass(n: number): number {
  function read(): number { return new LateBox(n).value; }
  class LateBox { constructor(public value: number) {} }
  return read();
}

export function repeatedInvocation(n: number): string {
  return earlyClass(n) + ";" + earlyClass(n + 1);
}

function escapingReader(n: number): () => number {
  const read = (): number => new EscapingBox(n).value;
  class EscapingBox { constructor(public value: number) {} }
  return read;
}

export function escapedClass(n: number): number {
  return escapingReader(n)();
}

export function hoistedClassReader(n: number): string {
  let before = "no throw";
  try { read(); } catch (error) {
    before = error instanceof ReferenceError ? error.message : "other";
  }
  class HoistedBox { constructor(public value: number) {} }
  function read(): number { return new HoistedBox(n).value; }
  return before + "/" + read();
}

export function classTypeof(n: number): string {
  const read = (): string => typeof TypeofBox;
  let before = "no throw";
  try { read(); } catch (error) {
    before = error instanceof ReferenceError ? error.message : "other";
  }
  class TypeofBox { constructor(public value: number) {} }
  return before + "/" + read() + "/" + n;
}

export function staticClassRead(n: number): string {
  function read(): number { return StaticBox.value; }
  let before = "no throw";
  try { read(); } catch (error) {
    before = error instanceof ReferenceError ? error.message : "other";
  }
  class StaticBox { static value = 5; }
  return before + "/" + read() + "/" + n;
}
