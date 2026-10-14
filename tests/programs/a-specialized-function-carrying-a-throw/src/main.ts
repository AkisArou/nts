// Exception mode composes with each generic instantiation. The nested and
// imported calls must keep the enclosing copy's substitutions, and closures
// created by either mode must use the same specialized capture layout.
import { captured, checked as imported, nested } from "./helpers.js";

class Box {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}

export function aNumber(n: number): number {
  try {
    return nested(n + 7, (n & 1) !== 0) * 3;
  } catch {
    return -101;
  }
}

export function aReference(n: number): number {
  try {
    return nested(new Box(n + 11), (n & 2) !== 0).value * 5;
  } catch {
    return -202;
  }
}

export function aClosure(n: number): number {
  const callback: () => number = () => n + 17;
  try {
    const chosen = nested(callback, (n & 4) !== 0);
    return chosen();
  } catch {
    return -303;
  }
}

export function aCapturedNumber(n: number): number {
  try {
    const chosen = captured(n + 23, (n & 8) !== 0);
    return chosen();
  } catch {
    return -404;
  }
}

export function aCapturedReference(n: number): number {
  try {
    const first = captured(new Box(n + 29), (n & 16) !== 0);
    const second = captured(new Box(n + 31), false);
    return first().value * 7 + second().value;
  } catch {
    return -505;
  }
}

export function anImportedCall(n: number): number {
  try {
    return imported(n + 37, (n & 1) !== 0);
  } catch {
    return -606;
  }
}

// An ordinary call still uses the ordinary specialization.
export function anOrdinaryCall(n: number): number {
  return nested(n + 41, false);
}

function plain(value: number, bad: boolean): number {
  if (bad) throw new Error("plain");
  return value;
}

export function thePlainControl(n: number): number {
  try {
    return plain(n + 7, (n & 1) !== 0) * 3;
  } catch {
    return -101;
  }
}
