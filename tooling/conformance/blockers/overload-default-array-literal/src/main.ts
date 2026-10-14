// expect: NTS1001 an array literal that is not an array is not supported by this lowering yet
//
// The implementation signature of an overloaded constructor, carrying an
// array-literal default (`= []`) for a parameter the overloads declare
// more narrowly, is refused: "an array literal that is not an array".
//
// The control is `countSingle` at the bottom of this file: the same
// parameter, the same union and the same default under a single
// signature, which lowers cleanly. The pair differs in one thing: the
// overload declarations above the implementation signature.
//
// This is the root refusal behind `exec`, `execFile` and `execSync` in
// `node:child_process`: none of them contains the construct; it sits in
// `Blob`'s constructor (buffer/src/blob.ts:462, overloads over
// `readonly BlobPart[] | ExternalBlobConstruction = []`), which
// child_process reaches through `node:buffer`. A cascade counted as a
// child_process refusal is a buffer constructor's, and this fixture is
// the reduction (measured on main e0b77e5a7, slice 1).

export class Token {
  n: number;
  constructor(n: number) {
    this.n = n;
  }
}

export class Holder {
  size: number;
  constructor();
  constructor(parts: readonly number[], opts?: { a?: number });
  constructor(parts: readonly number[] | Token = [], opts?: { a?: number }) {
    this.size = (parts instanceof Token ? parts.n : parts.length) + (opts?.a ?? 0);
  }
}

export function make(): Holder {
  return new Holder();
}

// Control shape (single signature, same union, same default): lowers.
export function countSingle(parts: readonly number[] | Token = []): number {
  if (parts instanceof Token) return parts.n;
  return parts.length;
}
