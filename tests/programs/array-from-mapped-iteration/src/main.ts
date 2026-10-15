// A mapper runs between iterator steps. Each control differs only in whether
// that mapper changes what the next step observes; all mutations are bounded.
function setAdding(n: number, change: boolean): string {
  const first = n & 15;
  const source = new Set<number>();
  source.add(first);
  source.add(first + 1);
  source.add(first + 2);
  source.delete(first + 1);
  const result = Array.from(source, (value, index) => {
    if (change && index === 0) source.add(first + 3);
    return value * 10 + index;
  });
  return result.join(",") + ":" + source.size;
}

export function setAddControl(n: number): string {
  return setAdding(n, false);
}

export function setAdds(n: number): string {
  return setAdding(n, true);
}

function setDeleting(n: number, change: boolean): string {
  const first = n & 15;
  const source = new Set<number>();
  source.add(first);
  source.add(first + 1);
  source.add(first + 2);
  const result = Array.from(source, (value, index) => {
    if (change && index === 0) source.delete(first + 1);
    return value * 10 + index;
  });
  return result.join(",") + ":" + source.size;
}

export function setDeleteControl(n: number): string {
  return setDeleting(n, false);
}

export function setDeletes(n: number): string {
  return setDeleting(n, true);
}

function mapAdding(n: number, change: boolean): string {
  const first = n & 15;
  const source = new Map<number, number>();
  source.set(0, first);
  source.set(1, first + 1);
  const result = Array.from(source.values(), (value, index) => {
    if (change && index === 0) source.set(2, first + 2);
    return value * 10 + index;
  });
  return result.join(",") + ":" + source.size;
}

export function mapAddControl(n: number): string {
  return mapAdding(n, false);
}

export function mapAdds(n: number): string {
  return mapAdding(n, true);
}

function arrayChanging(n: number, change: boolean): string {
  const source = [n, n + 1, n + 2];
  const result = Array.from(source, (value, index) => {
    if (change && index === 0) source[1] = n + 10;
    return value + index;
  });
  return result.join(",");
}

export function arrayWriteControl(n: number): string {
  return arrayChanging(n, false);
}

export function arrayWrites(n: number): string {
  return arrayChanging(n, true);
}

function arrayGrowing(n: number, change: boolean): string {
  const source = [n, n + 1];
  const result = Array.from(source, (value, index) => {
    if (change && index === 0) source.push(n + 2);
    return value + index;
  });
  return result.join(",");
}

export function arrayGrowControl(n: number): string {
  return arrayGrowing(n, false);
}

export function arrayGrows(n: number): string {
  return arrayGrowing(n, true);
}

function arrayShrinking(n: number, change: boolean): string {
  const source = [n, n + 1, n + 2];
  const result = Array.from(source, (value, index) => {
    if (change && index === 0) source.pop();
    return value + index;
  });
  return result.join(",");
}

export function arrayShrinkControl(n: number): string {
  return arrayShrinking(n, false);
}

export function arrayShrinks(n: number): string {
  return arrayShrinking(n, true);
}

// The callback index counts code points, independently of the UTF-16 cursor;
// the callback's output also has a different element type from its source.
export function unicodeIndices(n: number): string {
  return Array.from("a\u{1F600}b", (value, index) => value + ":" + (index + (n & 3))).join("|");
}

export function typedChangesType(n: number): string {
  const source = new Uint8Array(2);
  source[0] = n & 15;
  source[1] = (n & 15) + 1;
  return Array.from(source, (value, index) => "v" + value + ":" + index).join("|");
}

class Changing {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}

function* generated(state: Changing): Generator<number, void, unknown> {
  let i = 0;
  while (i < 3) {
    yield state.value + i;
    i = i + 1;
  }
}

function generatorMapping(n: number, change: boolean): string {
  const state = new Changing(n & 15);
  const result = Array.from(generated(state), (value, index) => {
    if (change) state.value = state.value + 10;
    return value + index;
  });
  return result.join(",");
}

export function generatorControl(n: number): string {
  return generatorMapping(n, false);
}

export function generatorInterleaves(n: number): string {
  return generatorMapping(n, true);
}

class Steps {
  at: number;
  state: Changing;
  constructor(state: Changing) {
    this.at = 0;
    this.state = state;
  }
  [Symbol.iterator](): Steps {
    return this;
  }
  next(): { value: number; done: boolean } {
    if (this.at === 3) return { value: 0, done: true };
    const value = this.state.value + this.at;
    this.at = this.at + 1;
    return { value, done: false };
  }
}

function protocolMapping(n: number, change: boolean): string {
  const state = new Changing(n & 15);
  const result = Array.from(new Steps(state), (value, index) => {
    if (change) state.value = state.value + 10;
    return value + index;
  });
  return result.join(",");
}

export function protocolControl(n: number): string {
  return protocolMapping(n, false);
}

export function protocolInterleaves(n: number): string {
  return protocolMapping(n, true);
}

export function emptyDoesNotCall(n: number): number {
  const source = new Set<number>();
  let calls = n;
  const result = Array.from(source, (value) => {
    calls = calls + 1;
    return value;
  });
  return calls + result.length;
}

// Returns on both branches must append once and reach the walk's latch;
// assignments to captured locals must survive both branches and iterations.
export function blockReturns(n: number): string {
  const source = new Set<number>();
  source.add(n);
  source.add(n + 1);
  let total = 0;
  const result = Array.from(source, (value, index) => {
    total = total + value;
    if (index === 0) return value + 10;
    return value + 20;
  });
  return result.join(",") + ":" + total;
}

export function conciseChangesType(n: number): string {
  return Array.from([n, n + 1], (value, index) => "v" + value + ":" + index).join("|");
}

// Rebinding a callback parameter must not change the private append position
// or the source element: both were read before that invocation's body ran.
export function reassignedParameters(n: number): string {
  const first = n & 15;
  const source = [first, first + 1];
  const result = Array.from(source, (value, index) => {
    value = value + 5;
    index = index + 7;
    return value * 10 + index;
  });
  return result.join(",") + ":" + source[0];
}
