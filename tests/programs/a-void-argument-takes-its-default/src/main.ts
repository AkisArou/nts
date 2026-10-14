function defaulted(a = 23, b = 45, c = 99): number {
  return a * 10000 + b * 100 + c;
}

let order = 0;
function record(value: number): number {
  order = order * 10 + value;
  return value;
}

function effects(a = record(4), b = record(5), c = 0): number {
  return a * 100 + b * 10 + c;
}

function derived(a = 23, b = a + 2, c = b + 3): number {
  return a * 10000 + b * 100 + c;
}

function shadows(undefined: number): number {
  return defaulted(undefined, 5, 6);
}

function raises(): number {
  throw new RangeError("argument");
}

export function explicitUndefined(n: number): number {
  return defaulted((undefined), (void 0)) + (n & 1);
}

export function allArgumentsBeforeDefaults(n: number): number {
  order = 0;
  const answer = effects((void record(1)), void record(2), record(3));
  return answer * 100000 + order + (n & 1);
}

export function defaultsReadPreviousParameters(n: number): number {
  return derived(undefined, void 0) + (n & 1);
}

export function aShadowedUndefinedIsAValue(n: number): number {
  return shadows(n);
}

export function anArgumentThrowSkipsTheDefault(n: number): number {
  order = 0;
  try {
    effects(void raises(), record(2), record(3));
  } catch {
    return order + (n & 1);
  }
  return -99;
}
