// A one-unit string compared is a unit read compared: `s[i] === "x"` and
// `s.charAt(i) === "x"` answer what `s.charCodeAt(i) === 120` does, without
// making the one-character string (`hir::simplify`). Out of range and below
// zero, `s[i]` is `undefined`, `charAt` is `""` and `charCodeAt` is `NaN`, and
// none of the three equals the unit.
//
// The one-difference control compares with a two-unit literal, `"ox"`, which
// no single unit can equal, so the string is still made and compared.

const TEXT = "the quick brown fox jumps over the lazy dog, six times";

export function countX(seed: number): number {
  let count = 0;
  for (let i = 0; i < TEXT.length; i++) {
    if (TEXT[i] === "x") {
      count = count + 1;
    }
  }
  return count + (seed & 0);
}

export function notO(seed: number): number {
  let count = 0;
  for (let i = 0; i < TEXT.length; i++) {
    if ("o" !== TEXT[i]) {
      count = count + 1;
    }
  }
  return count + (seed & 0);
}

export function charAtO(seed: number): number {
  let count = 0;
  for (let i = 0; i < TEXT.length; i++) {
    if (TEXT.charAt(i) === "o") {
      count = count + i;
    }
  }
  return count + (seed & 0);
}

// Indices from -60 to 67: below zero and past the end as well as inside.
export function anywhere(seed: number): number {
  const i = ((seed | 0) & 127) - 60;
  return (
    (TEXT[i] === "q" ? 1 : 0) +
    (TEXT.charAt(i) === "q" ? 2 : 0) +
    (TEXT[i] !== "t" ? 4 : 0) +
    (TEXT[-1] === "s" ? 8 : 0) +
    (TEXT.charAt(-1) === "s" ? 16 : 0)
  );
}

// The read the comparisons become, out of range: NaN on every backend.
export function unitAnywhere(seed: number): number {
  const i = ((seed | 0) & 127) - 60;
  return TEXT.charCodeAt(i);
}

export function twoUnits(seed: number): number {
  let count = 0;
  for (let i = 0; i + 1 < TEXT.length; i++) {
    if (TEXT[i] + TEXT[i + 1] === "ox") {
      count = count + 1;
    }
  }
  return count + (seed & 0);
}
