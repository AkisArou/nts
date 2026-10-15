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
export function numberRadix(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = (15).toString(pick(n));
      result += String(value) + ";";
    } catch (error) {
      // The old radix RangeError text has its own outcome guard. Here the
      // class and the new conversion TypeError's exact text are the claims.
      result += (error as Error).name === "RangeError" ? "RangeError;"
        : (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function numberRadixControl(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = (15).toString(converted(n, 10));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name === "RangeError" ? "RangeError;"
        : (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function numberDigits(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = (1.25).toFixed(pick(n));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function numberDigitsControl(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = (1.25).toFixed(converted(n, NaN));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

