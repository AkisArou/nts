// An elision over a value typed `any` steps whatever iterator the value has.
//
// `function skip([,]: any)` takes one `IteratorStep` per elision, and which
// iterator that is depends on what the caller passed -- so the pattern decides
// at run time, one arm per kind of value:
//
//   generator, twoSteps   a generator is resumed once per elision: the body
//                         runs to its first `yield` for one, past it for two,
//                         and `steps` counts the resumptions
//   exhausted             a finished generator is asked and answers done: no
//                         body runs
//   array, string, set,   a built-in iterable takes no step anything can
//   map, typedArray       observe, so none is taken; each answers its own count
//                         untouched
//   plainObject, number   not iterable: `GetIterator` throws a TypeError
//   nullValue,            and destructuring either of these throws one before
//   undefinedValue        any iterator is asked for
//
// Each arm returns what node returns. The generator arms are what Wasm's
// outcome an-elision-over-a-generator-does-not-step-it recorded wrong on
// every backend: the elision stepped nothing.
let steps = 0;

function* counted(seed: number): Generator<number> {
  steps = steps + 1;
  yield seed;
  steps = steps + 1;
  yield seed + 1;
}

function skip([,]: any): void {}

function skipTwo([, ,]: any): void {}

function thrown(value: unknown): number {
  try {
    skip(value);
    return 0;
  } catch (e) {
    return e instanceof TypeError ? 1 : 2;
  }
}

export function generator(seed: number): number {
  steps = 0;
  skip(counted(seed));
  return steps;
}

export function twoSteps(seed: number): number {
  steps = 0;
  skipTwo(counted(seed));
  return steps;
}

export function exhausted(seed: number): number {
  const done = counted(seed);
  done.next();
  done.next();
  done.next();
  steps = 0;
  skip(done);
  return steps;
}

export function array(seed: number): number {
  const values = [seed, seed + 1];
  skip(values);
  return values.length;
}

export function string(seed: number): number {
  const text = `${seed}`;
  skip(text);
  return text.length;
}

export function set(seed: number): number {
  const values = new Set([seed, seed + 1]);
  skip(values);
  return values.size;
}

export function map(seed: number): number {
  const values = new Map([[seed, seed + 1]]);
  skip(values);
  return values.size;
}

export function typedArray(seed: number): number {
  const values = new Float64Array([seed, seed + 1]);
  skip(values);
  return values.length;
}

export function plainObject(seed: number): number {
  return thrown({ seed });
}

export function number(seed: number): number {
  return thrown(seed);
}

export function nullValue(seed: number): number {
  return thrown(null) + (seed & 0);
}

export function undefinedValue(seed: number): number {
  return thrown(undefined) + (seed & 0);
}
