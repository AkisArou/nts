// run: check
// Object ToPrimitive is a later slice. An object whose conversion is exactly
// 2 must stop by name here rather than silently turn into NaN or payload bits.
// Only n=0 uses the object; the remaining inputs and the numeric control run.
class Two {
  valueOf(): number { return 2; }
  toString(): string { return "2"; }
}
function pick(k: number): any { return k === 0 ? new Two() : 2; }
function converted(_k: number, _default: number): number { return 2; }
export function typedOf(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = Uint8Array.of(pick(n), 3)[0];
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function typedOfControl(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = Uint8Array.of(converted(n, NaN), 3)[0];
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

