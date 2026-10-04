import { numberValue } from "./options.ts";
import type { SegmenterPrimitive } from "./segment-data.ts";
import { SegmentBoundaries } from "./segment-boundaries.ts";

function segmentData<P extends SegmenterPrimitive<P>>(
  input: string,
  boundaries: SegmentBoundaries<P>,
  word: boolean,
): Intl.SegmentData {
  const index = boundaries.start;
  const segment = input.slice(index, boundaries.end);
  return word
    ? { segment, index, input, isWordLike: boundaries.wordLike }
    : { segment, index, input };
}

// The typed iterator protocol retains canonical segment/result types.
// Intrinsic iterator inheritance and common helpers need runtime integration.
export class NtsSegmentIterator<P extends SegmenterPrimitive<P>> {
  readonly #primitive: P;
  readonly #input: string;
  readonly #word: boolean;
  #boundaries: SegmentBoundaries<P> | undefined;

  constructor(primitive: P, input: string, word: boolean) {
    this.#primitive = primitive;
    this.#input = input;
    this.#word = word;
  }

  next(): IteratorResult<Intl.SegmentData, undefined> {
    const input = this.#input;
    if (input.length === 0) return { value: undefined, done: true };
    let boundaries = this.#boundaries;
    if (boundaries === undefined) {
      boundaries = new SegmentBoundaries(this.#primitive.forText(input), input);
      this.#boundaries = boundaries;
    }
    return boundaries.advance()
      ? { value: segmentData(input, boundaries, this.#word), done: false }
      : { value: undefined, done: true };
  }

  [Symbol.iterator](): NtsSegmentIterator<P> {
    return this;
  }
}

export class NtsSegments<P extends SegmenterPrimitive<P>> {
  readonly #primitive: P;
  readonly #input: string;
  readonly #word: boolean;
  #boundaries: SegmentBoundaries<P> | undefined;

  constructor(primitive: P, input: string, word: boolean) {
    this.#primitive = primitive;
    this.#input = input;
    this.#word = word;
  }

  containing(codeUnitIndex?: number): Intl.SegmentData | undefined {
    const input = this.#input;
    const number = codeUnitIndex === undefined ? 0 : numberValue(codeUnitIndex);
    const index = Number.isNaN(number) ? 0 : Math.trunc(number);
    if (!(index >= 0 && index < input.length)) return undefined;
    let boundaries = this.#boundaries;
    if (boundaries === undefined) {
      boundaries = new SegmentBoundaries(this.#primitive.forText(input), input);
      this.#boundaries = boundaries;
    }
    boundaries.find(index);
    return segmentData(input, boundaries, this.#word);
  }

  [Symbol.iterator](): NtsSegmentIterator<P> {
    return new NtsSegmentIterator(this.#primitive, this.#input, this.#word);
  }
}
