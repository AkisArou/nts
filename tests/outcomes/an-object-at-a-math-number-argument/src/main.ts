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
export function mathUnary(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = Math.abs(pick(n));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function mathUnaryControl(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = Math.abs(converted(n, NaN));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function mathUnaryCall(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = Math.sign(pick(n));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function mathUnaryCallControl(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = Math.sign(converted(n, NaN));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function mathBinaryCall(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = Math.pow(pick(n), 2);
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function mathBinaryCallControl(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = Math.pow(converted(n, NaN), 2);
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function mathFold(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = Math.max(-1, pick(n));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function mathFoldControl(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = Math.max(-1, converted(n, NaN));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function globalPredicate(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = isFinite(pick(n));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function globalPredicateControl(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = isFinite(converted(n, NaN));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

