// run: check
// A lexical binding read before initialization must throw a catchable
// ReferenceError, including through a closure, typeof, or a class constructor.
function kind(error: unknown): string {
  return error instanceof ReferenceError ? "ReferenceError" :
    error instanceof Error ? "Error" : "other";
}

export function constRead(n: number): string {
  function read(): number { return x + n; }
  let out = "";
  try { out = "no throw " + read(); } catch (error) { out = kind(error); }
  const x = 1;
  return out + "/" + read();
}

export function letRead(n: number): string {
  const read = (): number => y * n;
  let out = "";
  try { out = "no throw " + read(); } catch (error) { out = kind(error); }
  let y = 2;
  y += n;
  return out + "/" + read();
}

export function classRead(n: number): string {
  function make(): number { return new Box(n).value; }
  let out = "";
  try { out = "no throw " + make(); } catch (error) { out = kind(error); }
  class Box {
    constructor(public value: number) {}
  }
  return out + "/" + make();
}

export function typeofRead(n: number): string {
  function read(): string { return typeof z; }
  let out = "";
  try { out = "no throw " + read(); } catch (error) { out = kind(error); }
  const z = n;
  return out + "/" + read();
}

export function messageNames(n: number): string {
  function read(): number { return w + n; }
  try {
    read();
    return "no throw";
  } catch (error) {
    return error instanceof Error ?
      (error.message.includes("w") ? "names w" : "message: " + error.message) :
      "other";
  }
  const w = 3;
}
