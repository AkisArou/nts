import {
  convertQueuingStrategyHighWaterMark,
  type QueuingStrategy,
  type QueuingStrategyInit,
  type QueuingStrategySize,
} from "./queuing-strategy.ts";

// The Standard gives each environment one non-constructible function shared by
// every instance. Its lexical name also supplies the observable function name.
const size = (): number => 1;

export class CountQueuingStrategy implements QueuingStrategy<unknown> {
  readonly #highWaterMark: number;

  constructor(init: QueuingStrategyInit);
  constructor(...args: [init?: QueuingStrategyInit]) {
    this.#highWaterMark = convertQueuingStrategyHighWaterMark(args, "CountQueuingStrategy");
  }

  get highWaterMark(): number {
    return this.#highWaterMark;
  }

  get size(): QueuingStrategySize<unknown> {
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
      value: "CountQueuingStrategy",
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
