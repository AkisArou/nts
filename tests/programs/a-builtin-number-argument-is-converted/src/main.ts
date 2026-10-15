// State-dependent view/buffer families await their receiver-precondition slice.
// Every primitive numeric conversion is driven explicitly in each run.
// Numeric controls change only the argument, after applying its language
// conversion. Symbols and bigints must throw catchable TypeErrors. Object
// stops have separate outcome guards until the ToPrimitive slice.
function pick(k: number): any {
  if (k === 0) return "2";
  if (k === 1) return true;
  if (k === 2) return false;
  if (k === 3) return null;
  if (k === 4) return undefined;
  if (k === 5) return "not a number";
  if (k === 6) return Symbol("number argument");
  if (k === 7) return 3n;
  if (k === 8) return -0;
  if (k === 9) return NaN;
  if (k === 10) return 2.5;
  return 1;
}
function converted(k: number, undefinedValue: number): number {
  if (k === 0) return 2;
  if (k === 1 || k === 11) return 1;
  if (k === 2 || k === 3) return 0;
  if (k === 4) return undefinedValue;
  if (k === 6) throw new TypeError("Cannot convert a Symbol value to a number");
  if (k === 7) throw new TypeError("Cannot convert a BigInt value to a number");
  if (k === 8) return -0;
  if (k === 10) return 2.5;
  return NaN;
}

export function stringStart(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = "abcdef".slice(pick(i), 5);
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringStartControl(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = "abcdef".slice(converted(i, NaN), 5);
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringEnd(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = "abcdef".slice(0, pick(i));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringEndControl(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = "abcdef".slice(0, converted(i, Infinity));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringUnit(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = "abcdef".charCodeAt(pick(i));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringUnitControl(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = "abcdef".charCodeAt(converted(i, NaN));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringPoint(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = "abcdef".codePointAt(pick(i));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringPointControl(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = "abcdef".codePointAt(converted(i, NaN));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringAt(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = "abcdef".at(pick(i));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringAtControl(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = "abcdef".at(converted(i, NaN));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringRepeat(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = "ab".repeat(pick(i));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringRepeatControl(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = "ab".repeat(converted(i, NaN));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringPadding(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = "x".padStart(pick(i), "a");
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringPaddingControl(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = "x".padStart(converted(i, NaN), "a");
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringSearchPosition(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = "abba".indexOf("b", pick(i));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringSearchPositionControl(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = "abba".indexOf("b", converted(i, NaN));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringSplitLimit(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = "a,b,c".split(",", pick(i)).join("|");
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function stringSplitLimitControl(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = "a,b,c".split(",", converted(i, 4294967295)).join("|");
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function arrayStart(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = [1, 2, 3, 4].slice(pick(i), 3).join(",");
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function arrayStartControl(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = [1, 2, 3, 4].slice(converted(i, NaN), 3).join(",");
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function arrayEnd(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = [1, 2, 3, 4].slice(0, pick(i)).join(",");
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function arrayEndControl(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = [1, 2, 3, 4].slice(0, converted(i, Infinity)).join(",");
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function mathUnary(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = Math.abs(pick(i));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function mathUnaryControl(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = Math.abs(converted(i, NaN));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function mathUnaryCall(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = Math.sign(pick(i));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function mathUnaryCallControl(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = Math.sign(converted(i, NaN));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function mathBinaryCall(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = Math.pow(pick(i), 2);
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function mathBinaryCallControl(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = Math.pow(converted(i, NaN), 2);
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function mathFold(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = Math.max(-1, pick(i));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function mathFoldControl(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = Math.max(-1, converted(i, NaN));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function globalPredicate(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = isFinite(pick(i));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function globalPredicateControl(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = isFinite(converted(i, NaN));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function codeUnit(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = String.fromCharCode(pick(i));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function codeUnitControl(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = String.fromCharCode(converted(i, NaN));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function codePoint(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = String.fromCodePoint(pick(i));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function codePointControl(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = String.fromCodePoint(converted(i, NaN));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function numberRadix(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = (15).toString(pick(i));
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
  for (let i = 0; i < 12; i++) {
    try {
      const value = (15).toString(converted(i, 10));
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
  for (let i = 0; i < 12; i++) {
    try {
      const value = (1.25).toFixed(pick(i));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function numberDigitsControl(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = (1.25).toFixed(converted(i, NaN));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function bigintWidth(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = BigInt.asIntN(pick(i), 5n).toString();
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function bigintWidthControl(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = BigInt.asIntN(converted(i, NaN), 5n).toString();
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function parseRadix(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = parseInt("11", pick(i));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function parseRadixControl(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = parseInt("11", converted(i, NaN));
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function typedOf(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = Uint8Array.of(pick(i), 3)[0];
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

export function typedOfControl(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) {
    try {
      const value = Uint8Array.of(converted(i, NaN), 3)[0];
      result += String(value) + ";";
    } catch (error) {
      result += (error as Error).name + ": " + (error as Error).message + ";";
    }
  }
  return result + String(n & 3);
}

