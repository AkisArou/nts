import { Shape } from "./shape.ts";

/** One `Box`, with one field. */
export class Box extends Shape {
  readonly side: number;

  constructor(side: number) {
    super();
    this.side = side;
  }

  area(): number {
    return this.side * this.side;
  }

  get label(): number {
    return 1;
  }

  static made(): number {
    return 100;
  }
}

export function origin(): number {
  return 7;
}

/**
 * A second name both modules use, and this pair has **no fields at all** -- so
 * their layouts are identical and legitimately share one struct. That is the
 * shape React's reduction had, and the one that segfaulted silently: with
 * differing fields the old compiler refused instead, so an example built only
 * from `Box` would have measured the louder half.
 */
export class Tag extends Shape {
  area(): number {
    return 4;
  }
}
