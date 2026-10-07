// A binding module and the global class the program uses that it implements
// by delegation -- lib.dom and nts:dom in miniature: the static `Ticker.parse`
// is the binding's `Ticker_parse`, as its constructor would be `newTicker`.
declare module "x:ticker" {
  import type { HostClass, c_double } from "c:types";
  export type Ticker = HostClass<"XTicker", null, "x_ticker_retain", "x_ticker_release">;
  /** @ntsSymbol x_ticker_parse */
  export function Ticker_parse(text: string): c_double;
  /** @ntsSymbol x_ticker_parse_base */
  export function Ticker_parse(text: string, base: c_double): c_double;
}

/** @ntsBoundBy "x:ticker" Ticker */
interface Ticker {}
declare var Ticker: {
  prototype: Ticker;
  parse(text: string, base?: number): number;
};
