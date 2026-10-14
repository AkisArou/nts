import { Shape } from "./shape.ts";

/**
 * The other `Box`, with **two** fields -- so the two do not merely share a name,
 * they disagree about their layout. One `struct NtsObj_Box` for both would read
 * `width` where the other keeps `side`.
 */
export class Box extends Shape {
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    super();
    this.width = width;
    this.height = height;
  }

  area(): number {
    return this.width * this.height;
  }

  get label(): number {
    return 2;
  }

  static made(): number {
    return 200;
  }
}

export function origin(): number {
  return 9;
}

/** The other `Tag`, also fieldless, answering differently. */
export class Tag extends Shape {
  area(): number {
    return 6;
  }
}
