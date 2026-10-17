// run: check
// expect-ir: all: count call.extern(nts_raising) in observed == 2
// expect-ir: all: no call.extern(nts_raising) in quiet
// The control changes only which protocol method throws.
class Source implements IterableIterator<number> {
  count = 0;
  closed = 0;
  constructor(public failure: number) {}
  [Symbol.iterator](): IterableIterator<number> {
    if (this.failure === 1) throw 22;
    return this;
  }
  next(): IteratorResult<number> {
    if (this.failure === 2) throw 22;
    this.count++;
    return { value: this.count, done: this.count > 1 };
  }
  return(): IteratorResult<number> {
    this.closed++;
    return { value: 0, done: true };
  }
}
class OtherSource implements IterableIterator<number> {
  identity = 2;
  count = 0;
  closed = 0;
  constructor(public failure: number) {}
  [Symbol.iterator](): IterableIterator<number> {
    if (this.failure === 1) throw 22;
    return this;
  }
  next(): IteratorResult<number> {
    if (this.failure === 2) throw 22;
    this.count++;
    return { value: this.count, done: this.count > 1 };
  }
  return(): IteratorResult<number> {
    this.closed++;
    return { value: 0, done: true };
  }
}
function observed(failure: number): number {
  const source = new Source(failure);
  let total = 0;
  try { for (const value of source) total += value; }
  catch (e) { return e === 22 ? 100 + source.closed : -1; }
  return total;
}
export function iteratorSubject(n: number): number { return observed(n === 1 ? 1 : 0) + (n & 0); }
export function iteratorControl(n: number): number { return observed(0) + (n & 0); }
export function nextSubject(n: number): number { return observed(n === 1 ? 2 : 0) + (n & 0); }
export function nextControl(n: number): number { return observed(0) + (n & 0); }

function observedInterface(source: IterableIterator<number>): number {
  let total = 0;
  try { for (const value of source) total += value; }
  catch (e) { return e === 22 ? 100 : -1; }
  return total;
}
export function interfaceSubject(n: number): number {
  return observedInterface(new OtherSource(n === 1 ? 1 : 0)) + (n & 0);
}
export function interfaceControl(n: number): number {
  return observedInterface(new OtherSource(0)) + (n & 0);
}
export function fromSubject(n: number): number {
  try { return Array.from(new Source(n === 1 ? 2 : 0)).length; }
  catch (e) { return e === 22 ? 100 : -1; }
}
export function fromControl(n: number): number {
  try { return Array.from(new Source(0)).length; }
  catch (e) { return e === 22 ? 100 : -1; }
}

class RestSource {
  count = 0;
  closed = 0;
  constructor(public failure: number) {}
  [Symbol.iterator](): RestSource {
    if (this.failure === 1) throw 22;
    return this;
  }
  next(): { value: number; done: boolean } {
    if (this.failure === 2) throw 22;
    this.count++;
    return { value: this.count, done: this.count > 1 };
  }
  return(): { value: number; done: boolean } {
    this.closed++;
    return { value: 0, done: true };
  }
}

export function restIteratorSubject(n: number): number {
  try { const [...tail] = new RestSource(n === 1 ? 1 : 0); return tail.length; }
  catch (e) { return e === 22 ? 100 : -1; }
}
export function restIteratorControl(n: number): number {
  try { const [...tail] = new RestSource(0); return tail.length; }
  catch (e) { return e === 22 ? 100 : -1; }
}
export function restNextSubject(n: number): number {
  try { const [...tail] = new RestSource(n === 1 ? 2 : 0); return tail.length; }
  catch (e) { return e === 22 ? 100 : -1; }
}
export function restNextControl(n: number): number {
  try { const [...tail] = new RestSource(0); return tail.length; }
  catch (e) { return e === 22 ? 100 : -1; }
}

class QuietSource {
  count = 0;
  next(): { value: number; done: boolean } {
    this.count++;
    return { value: this.count, done: this.count > 1 };
  }
  [Symbol.iterator](): QuietSource { return this; }
}
export function quiet(n: number): number {
  let total = 0;
  try { for (const value of new QuietSource()) total += value; }
  catch (e) { return -1; }
  return total + (n & 0);
}

function restParameter([...tail]: RestSource): number { return tail.length; }
export function parameterSubject(n: number): number {
  try { return restParameter(new RestSource(n === 1 ? 2 : 0)); }
  catch (e) { return e === 22 ? 100 : -1; }
}
export function parameterControl(n: number): number {
  try { return restParameter(new RestSource(0)); }
  catch (e) { return e === 22 ? 100 : -1; }
}
function* delegated(failure: number): Generator<number> { yield* new Source(failure); }
export function delegatedIteratorSubject(n: number): number {
  let total = 0;
  try { for (const value of delegated(n === 1 ? 1 : 0)) total += value; }
  catch (e) { return e === 22 ? 100 : -1; }
  return total;
}
export function delegatedIteratorControl(n: number): number {
  let total = 0;
  try { for (const value of delegated(0)) total += value; }
  catch (e) { return e === 22 ? 100 : -1; }
  return total;
}
export function delegatedNextSubject(n: number): number {
  let total = 0;
  try { for (const value of delegated(n === 1 ? 2 : 0)) total += value; }
  catch (e) { return e === 22 ? 100 : -1; }
  return total;
}
export function delegatedNextControl(n: number): number {
  let total = 0;
  try { for (const value of delegated(0)) total += value; }
  catch (e) { return e === 22 ? 100 : -1; }
  return total;
}
