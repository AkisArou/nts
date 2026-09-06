import {
  convertQueuingStrategyHighWaterMark,
  type QueuingStrategy,
  type QueuingStrategyInit,
  type QueuingStrategySize,
} from "./queuing-strategy.ts";

// The Standard gives each environment one non-constructible function shared by
// every instance. Its lexical name also supplies the observable function name.
const size = (chunk: ArrayBufferView<ArrayBuffer>): number => chunk.byteLength;

export class ByteLengthQueuingStrategy implements QueuingStrategy<ArrayBufferView<ArrayBuffer>> {
  readonly #highWaterMark: number;

  constructor(init: QueuingStrategyInit);
  constructor(...args: [init?: QueuingStrategyInit]) {
    this.#highWaterMark = convertQueuingStrategyHighWaterMark(args, "ByteLengthQueuingStrategy");
  }

  get highWaterMark(): number {
    return this.#highWaterMark;
  }

  get size(): QueuingStrategySize<ArrayBufferView<ArrayBuffer>> {
    this.#highWaterMark;
    return size;
  }

  get [Symbol.toStringTag](): "ByteLengthQueuingStrategy" {
    return "ByteLengthQueuingStrategy";
  }
}
