// A class whose constructor is refused, and a class whose constructor is not.
//
// `_read` is a method, so its slot is a vtable entry rather than a field that
// can hold a closure. Assigning one refuses the *constructor*, which is how
// node's `Readable`, `Writable`, `Duplex` and `Transform` are all written.
export class Refused {
  n: number = 0;
  constructor(options?: { read?: (size: number) => void }) {
    if (options && typeof options.read === "function") {
      this._read = options.read;
    }
  }
  _read(_size: number): void {
    this.n = 1;
  }
}

export class Fine {
  n: number = 0;
  constructor() {
    this.n = 1;
  }
}

// A second refused constructor. `note_uncompiled` deduplicates on the *simple*
// name before it records the qualified one, so the second class to refuse a
// member called `constructor` was silently dropped even once the first was
// recorded. node's `stream` refuses four in one module.
export class AlsoRefused {
  n: number = 0;
  constructor(options?: { read?: (size: number) => void }) {
    if (options && typeof options.read === "function") {
      this._read = options.read;
    }
  }
  _read(_size: number): void {
    this.n = 2;
  }
}
