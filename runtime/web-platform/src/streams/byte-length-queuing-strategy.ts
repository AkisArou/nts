import {
  convertQueuingStrategyHighWaterMark,
  type QueuingStrategy,
  type QueuingStrategyInit,
  type QueuingStrategySize,
} from "./queuing-strategy.ts";

// The Standard gives each environment one non-constructible function shared by
// every instance. Its lexical name also supplies the observable function name.
const size = (chunk: ArrayBufferView<ArrayBuffer> | undefined): number => {
  if (chunk === undefined) {
    throw new TypeError("Chunk must be an ArrayBuffer view");
  }
  return chunk.byteLength;
};

export class ByteLengthQueuingStrategy implements QueuingStrategy<
  ArrayBufferView<ArrayBuffer> | undefined
> {
  readonly #highWaterMark: number;

  constructor(init: QueuingStrategyInit);
  constructor(...args: [init?: QueuingStrategyInit]) {
    this.#highWaterMark = convertQueuingStrategyHighWaterMark(args, "ByteLengthQueuingStrategy");
  }

  get highWaterMark(): number {
    return this.#highWaterMark;
  }

  get size(): QueuingStrategySize<ArrayBufferView<ArrayBuffer> | undefined> {
    this.#highWaterMark;
    return size;
  }

  get [Symbol.toStringTag](): "ByteLengthQueuingStrategy" {
    return "ByteLengthQueuingStrategy";
  }
}
