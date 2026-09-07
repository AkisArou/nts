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
