// A call through a value the whole program gives at most two classes is a
// test per class and a direct call (`class_sets`); a call through anything
// it cannot see whole is left as it was. Each export is one edge of that rule,
// and each must agree with node either way.

// Two closures in a local array read in a loop: the shape the rule is for.
export function twoInALocalArray(n: number): number {
  const fs = [(x: number): number => x * 2, (x: number): number => x + 3];
  let total = 0;
  for (let i = 0; i < 16 + (n & 7); i = i + 1) {
    total = total + fs[i & 1](i);
  }
  return total;
}

// Three classes: past the two it tests, so the call keeps its dispatch.
export function threeInALocalArray(n: number): number {
  const fs = [
    (x: number): number => x * 2,
    (x: number): number => x + 3,
    (x: number): number => x - 5,
  ];
  let total = 0;
  for (let i = 0; i < 18 + (n & 7); i = i + 1) {
    total = total + fs[i % 3](i);
  }
  return total;
}

// The array leaves the function, so something else could write into it.
function apply(fs: ((x: number) => number)[], i: number): number {
  return fs[i & 1](i);
}
export function anEscapingArray(n: number): number {
  const fs = [(x: number): number => x * 2, (x: number): number => x + 3];
  let total = 0;
  for (let i = 0; i < 16 + (n & 7); i = i + 1) {
    total = total + apply(fs, i);
  }
  return total;
}

// A call that throws inside `try`: the arm's direct call throws the same way.
export function aCallInsideTry(n: number): number {
  const fs = [
    (x: number): number => x * 2,
    (x: number): number => {
      if (x > 3) {
        throw new Error("big");
      }
      return x;
    },
  ];
  let total = 0;
  for (let i = 0; i < 8 + (n & 3); i = i + 1) {
    try {
      total = total + fs[i & 1](i);
    } catch (e) {
      total = total + 100;
    }
  }
  return total;
}

// A method through a parameter every caller gives one of two classes.
class Square {
  side: number;
  constructor(side: number) {
    this.side = side;
  }
  area(): number {
    return this.side * this.side;
  }
}
class Rect extends Square {
  other: number;
  constructor(side: number, other: number) {
    super(side);
    this.other = other;
  }
  override area(): number {
    return this.side * this.other;
  }
}
function areaOf(shape: Square): number {
  return shape.area();
}
export function aMethodThroughAParameter(n: number): number {
  return areaOf(new Square(n & 15)) + areaOf(new Rect(n & 15, 3));
}

// Recursion handing its parameter on: the parameter's classes are the
// callers' alone, the recursive call adding none.
function countDown(f: (x: number) => number, k: number): number {
  return k <= 0 ? 0 : f(k) + countDown(f, k - 1);
}
export function recursionHandsItOn(n: number): number {
  return countDown((x: number): number => x * 2, 4 + (n & 3)) + countDown((x: number): number => x + 3, 3);
}

// A closure that reads its own captured state, called through the array.
export function aClosureReadingItsCapture(n: number): number {
  const base = n & 31;
  const fs = [(x: number): number => x + base, (x: number): number => x * base];
  let total = 0;
  for (let i = 0; i < 8; i = i + 1) {
    total = total + fs[i & 1](i);
  }
  return total;
}

// A generator's step function through a parameter.
function* steps(f: (x: number) => number, limit: number): Generator<number> {
  for (let i = 0; i < limit; i = i + 1) {
    yield f(i);
  }
}
export function aGeneratorThroughAParameter(n: number): number {
  let total = 0;
  for (const v of steps(n < 0 ? (x: number): number => x * 2 : (x: number): number => x + 3, 6)) {
    total = total + v;
  }
  return total;
}

// Closures read out of module constants: a global load is not a source this
// sees yet (fields, globals and return values are the next stage), so the
// call keeps its dispatch.
const double = (x: number): number => x * 2;
const plus = (x: number): number => x + 3;
export function aModuleConstantIsNotSeenYet(n: number): number {
  const fs = [double, plus];
  let total = 0;
  for (let i = 0; i < 16 + (n & 7); i = i + 1) {
    total = total + fs[i & 1](i);
  }
  return total;
}

// expect-ir: all: no call.closure in twoInALocalArray
// expect-ir: all: count instanceof in twoInALocalArray#whole == 2
// expect-ir: all: count call.closure in threeInALocalArray >= 1
// expect-ir: all: no instanceof in threeInALocalArray
// expect-ir: all: count call.closure in apply >= 1
// expect-ir: all: no call.closure in aCallInsideTry
// expect-ir: all: no call.virtual in areaOf
// expect-ir: all: no call.closure in countDown
// expect-ir: all: count call.closure in aModuleConstantIsNotSeenYet >= 1
