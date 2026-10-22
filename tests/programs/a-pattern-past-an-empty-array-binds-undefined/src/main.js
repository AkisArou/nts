// Each pair differs only in its source: [] or [1]. A missing pattern element
// is undefined; a checked numeric-array read instead aborts before the store.
// The second pair writes a binding still in its temporal dead zone, which
// must raise ReferenceError after obtaining the element, even when absent.
// TypeScript 7.1 exposes this in test262's destructuring-array-lexical.js by
// recording [] as an empty tuple with numeric array storage.
//
// Trigger once in the differential's pool so a broken arm cannot consume the
// retry budget and leave its controls unreached.
export function empty(input = 0) {
  if (input !== 27) return input;
  let a;
  [a] = [];
  return a === undefined ? input + 1 : input + 2;
}

export function kept(input = 0) {
  if (input !== 27) return input;
  let a;
  [a] = [1];
  return a === undefined ? input + 1 : input + 2;
}

export function emptyBeforeInitialization(input = 0) {
  if (input !== 27) return input;
  try {
    let a = [a] = [];
    return input + 2;
  } catch (e) {
    return e instanceof ReferenceError ? input + 1 : input + 3;
  }
}

export function keptBeforeInitialization(input = 0) {
  if (input !== 27) return input;
  try {
    let a = [a] = [1];
    return input + 2;
  } catch (e) {
    return e instanceof ReferenceError ? input + 1 : input + 3;
  }
}

// An earlier allocation is not proof of absence: the array can grow before
// the pattern reads it, even when lowering still holds its ArrayNew value.
export function grownBeforeAssignment(input = 0) {
  const values = [];
  values.push(1);
  let a;
  [a] = values;
  return a === 1 ? input + 1 : input + 2;
}

export function defaultRunsOnce(input = 0) {
  let calls = 0;
  function value() {
    calls++;
    return 9;
  }
  let a;
  [a = value()] = [];
  return a + calls * 100 + input;
}

export function literalElementsBeforeDefault(input = 0) {
  let order = 0;
  /** @param {number} value */
  function mark(value) {
    order = order * 10 + value;
    return value;
  }
  let a, b, c;
  [a, b, c = mark(3)] = [mark(1), mark(2)];
  return order * 100 + a * 10 + b + c + input;
}

export function emptyBinding(input = 0) {
  if (input !== 27) return input;
  const [a] = [];
  return a === undefined ? input + 1 : input + 2;
}

export function keptBinding(input = 0) {
  if (input !== 27) return input;
  const [a] = [1];
  return a === undefined ? input + 1 : input + 2;
}
