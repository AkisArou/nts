/** @ntsHeader "scroll.h" */
declare module "c:scroll" {
  import type { ByValue, Fields, Struct } from "c:types";
  import type { c_int } from "@nts/scalars";
  export type Options = Struct<{ block: c_int; inline: c_int }, "Options">;
  export function scroll(options: ByValue<Options> | Fields<Options>): c_int;
}
