declare module "x:visit" {
  import type { StringView } from "c:types";
  import type { c_int } from "@nts/scalars";
  /** Calls `before`, allocates, then reads `s`. @ntsSymbol visit */
  export function visit(s: StringView, before: () => void): c_int;
}
