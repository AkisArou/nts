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


  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    // Web IDL member attributes. This prototype carries no non-standard names, so the pass
    // reaches only the interface's own members.
    for (const key of Object.getOwnPropertyNames(this.prototype)) {
      if (key === "constructor") continue;
      const descriptor = Object.getOwnPropertyDescriptor(this.prototype, key);
      if (descriptor === undefined || descriptor.enumerable) continue;
      descriptor.enumerable = true;
      Object.defineProperty(this.prototype, key, descriptor);
    }
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "ByteLengthQueuingStrategy",
      writable: false,
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(this, "length", {
      value: 1,
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}
