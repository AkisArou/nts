// A raising structural copy keeps its concrete parameter and closure capture
// layout. Calling the unspecialized raising body would read the wrong field.
interface Named {
  value: number;
}

class Book {
  padding = 1000;
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}

function read(value: Named, bad: boolean): number {
  if (bad) throw new Error("structural");
  return value.value;
}

function forward(value: Named, bad: boolean): number {
  return read(value, bad) * 3;
}

function capture(value: Named, bad: boolean): () => number {
  if (bad) throw new Error("capture");
  return () => read(value, false);
}

export function throughTwoCopies(n: number): number {
  try {
    return forward(new Book(n + 5), (n & 1) !== 0);
  } catch {
    return -707;
  }
}

export function throughACapture(n: number): number {
  try {
    const first = capture(new Book(n + 7), (n & 2) !== 0);
    const second = capture(new Book(n + 11), false);
    return first() * 5 + second();
  } catch {
    return -808;
  }
}

export function theOrdinaryControl(n: number): number {
  return forward(new Book(n + 5), false);
}
