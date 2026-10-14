// A binding module and the global class the program uses that it implements
// by delegation -- lib.dom and nts:dom in miniature: the static `Ticker.parse`
// is the binding's `Ticker_parse`, as its constructor would be `newTicker`.
declare module "x:ticker" {
  import type { HostClass } from "c:types";
  import type { Float64 } from "@nts/scalars";
  export type Ticker = HostClass<"XTicker", null, "x_ticker_retain", "x_ticker_release">;
  /** @ntsSymbol x_ticker_parse */
  export function Ticker_parse(text: string): Float64;
  /** @ntsSymbol x_ticker_parse_base */
  export function Ticker_parse(text: string, base: Float64): Float64;
}

/** @ntsBoundBy "x:ticker" Ticker */
interface Ticker {}
declare var Ticker: {
  prototype: Ticker;
  parse(text: string, base?: number): number;
};
