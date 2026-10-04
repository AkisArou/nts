import type { SegmenterPrimitive } from "./segment-data.ts";

export class SegmentBoundaries<P extends SegmenterPrimitive<P>> {
  readonly #primitive: P;
  readonly #input: string;
  #start = 0;
  #end = 0;
  #status = 0;

  constructor(primitive: P, input: string) {
    this.#primitive = primitive;
    this.#input = input;
  }

  get start(): number {
    return this.#start;
  }
  get end(): number {
    return this.#end;
  }
  get wordLike(): boolean {
    // Public ICU word tags: numbers, letters, kana and ideographs.
    return this.#status >= 100 && this.#status < 500;
  }

  advance(): boolean {
    if (this.#end >= this.#input.length) return false;
    const start = this.#end;
    const end = this.#primitive.next();
    this.setRange(start, end);
    return true;
  }

  find(index: number): boolean {
    const input = this.#input;
    if (!(index >= 0 && index < input.length)) return false;
    if (index >= this.#start && index < this.#end) return true;
    // Find the containing end once, then walk its adjacent boundaries. This
    // preserves UTF-16 pair semantics and ICU's cached dictionary boundaries.
    const end = this.#primitive.following(index);
    const start = this.#primitive.previous();
    if (this.#primitive.next() !== end) throw new Error("Inconsistent ICU segmentation boundary");
    this.setRange(start, end);
    return true;
  }

  private setRange(start: number, end: number): void {
    if (!(start >= 0 && start < end && end <= this.#input.length))
      throw new Error("Invalid ICU segmentation boundary");
    this.#start = start;
    this.#end = end;
    this.#status = this.#primitive.ruleStatus();
  }
}
