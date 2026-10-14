// A binding module, and a global type the program uses that it implements by
// delegation -- the shape of lib.dom.d.ts and nts:dom, in miniature.
declare module "x:ticker" {
  import type { Closure, HostClass } from "c:types";
  import type { Float64, c_int } from "@nts/scalars";
  export type Ticker = HostClass<"XTicker", null, "x_ticker_retain", "x_ticker_release"> & TickerMethods;
  export interface TickerMethods {
    /** @ntsSymbol x_ticker_once */
    start(this: Ticker, callback: Closure<(at: Float64) => void>): c_int;
    /** @ntsSymbol x_ticker_every */
    start(this: Ticker, callback: Closure<(at: Float64) => void>, every: Float64): c_int;
  }
  /** @ntsSymbol x_ticker */
  export function ticker(): Ticker;
}

/** @ntsBoundBy "x:ticker" Ticker */
interface Ticker {
  start(callback: (at: number) => void, every?: number): number;
}
/** @ntsBoundBy "x:ticker" ticker */
declare var ticker: Ticker;
