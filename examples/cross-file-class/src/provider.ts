// The classes. A symbol is interned once, by whichever file gets to it first,
// and `declaration_index` keeps only the declarations that are in *that* file.
// So a class first reached from a file that merely mentions it was recorded
// with **no declarations** — and `decompose`'s library boundary is `is_ours`,
// which is exactly "does this symbol have any declarations". The class was then
// treated as though it came from `lib.d.ts`: never decomposed, no type, and
// every member refused as "a class this compiler has no type for".
//
// In `runtime/node` that was `Readable` and `Duplex` and nothing else in
// `stream` — 110 refusals there, and 187 more classes refused for having a base
// that was.
import { offset } from "./helper.js";

export class Base {
  tag(): number {
    return 7;
  }
}

export class Counter extends Base {
  count: number;
  constructor(start: number) {
    super();
    this.count = offset(start);
  }
  bump(by: number): number {
    this.count = (this.count + by) | 0;
    return this.count;
  }
  get current(): number {
    return this.count;
  }
}
