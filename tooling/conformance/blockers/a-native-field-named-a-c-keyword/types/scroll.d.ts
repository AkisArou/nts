/** @ntsHeader "scroll.h" */
declare module "c:scroll" {
  import type { ByValue, Fields, Struct, c_int } from "c:types";
  export type Options = Struct<{ block: c_int; inline: c_int }, "Options">;
  export function scroll(options: ByValue<Options> | Fields<Options>): c_int;
}
