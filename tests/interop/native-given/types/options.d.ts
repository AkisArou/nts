/**
 * The dictionary of `native/options.h`, passed by value, whose `Given`
 * members C is told were given or not.
 *
 * @ntsHeader "options.h"
 */
declare module "c:options" {
  import type { ByValue, CBool, Fields, Given, Struct } from "c:types";
  import type { Float64, Int32, Uint8 } from "@nts/scalars";

  export type Options = Struct<
    { keepalive: Given<CBool<Uint8>>; priority: Given<Float64>; plain: Int32 },
    "options"
  >;

  export function options_report(label: string, options: ByValue<Options> | Fields<Options>): void;
}
