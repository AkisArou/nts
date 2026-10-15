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
export function stringStart(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = "abcdef".slice(pick(n), 5);
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringStartControl(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = "abcdef".slice(converted(n, NaN), 5);
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringEnd(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = "abcdef".slice(0, pick(n));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringEndControl(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = "abcdef".slice(0, converted(n, Infinity));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringUnit(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = "abcdef".charCodeAt(pick(n));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringUnitControl(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = "abcdef".charCodeAt(converted(n, NaN));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringPoint(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = "abcdef".codePointAt(pick(n));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringPointControl(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = "abcdef".codePointAt(converted(n, NaN));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringAt(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = "abcdef".at(pick(n));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringAtControl(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = "abcdef".at(converted(n, NaN));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringRepeat(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = "ab".repeat(pick(n));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringRepeatControl(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = "ab".repeat(converted(n, NaN));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringPadding(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = "x".padStart(pick(n), "a");
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringPaddingControl(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = "x".padStart(converted(n, NaN), "a");
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringSearchPosition(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = "abba".indexOf("b", pick(n));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringSearchPositionControl(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = "abba".indexOf("b", converted(n, NaN));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringSplitLimit(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = "a,b,c".split(",", pick(n)).join("|");
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringSplitLimitControl(n: number): string {
  let result = "";
  for (let i = 0; i < 1; i++) {
    try {
      const value = "a,b,c".split(",", converted(n, 4294967295)).join("|");
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

