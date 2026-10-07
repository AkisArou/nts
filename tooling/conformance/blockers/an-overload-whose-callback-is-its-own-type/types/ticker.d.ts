// A binding module, and a global type the program uses that it implements by
// delegation -- the shape of lib.dom.d.ts and nts:dom, in miniature.
declare module "x:ticker" {
  import type { Closure, HostClass, c_double, c_int } from "c:types";
  export type Ticker = HostClass<"XTicker", null, "x_ticker_retain", "x_ticker_release"> & TickerMethods;
  export interface TickerMethods {
    /** @ntsSymbol x_ticker_once */
    start(this: Ticker, callback: Closure<(at: c_double) => void>): c_int;
    /** @ntsSymbol x_ticker_every */
    start(this: Ticker, callback: Closure<(at: c_double) => void>, every: c_double): c_int;
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
