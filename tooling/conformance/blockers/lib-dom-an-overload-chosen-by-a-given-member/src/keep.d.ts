declare module "nts:dom" {
  import type { ByValue, CBool, Fields, Given, Ptr, StringView, Struct } from "c:types";
  import type { Uint8 } from "@nts/scalars";
  // RequestInit as a binding with Given carries it: keepalive told given or not.
  export type KeepInit = Struct<{ keepalive: Given<CBool<Uint8>>; method: StringView }, "NtsDomKeepInit">;
  /**
   * @ntsSymbol keep_request
   * @ntsThrows error nts_dom_exception_take_message
   * @ntsNoEscape error
   */
  export function newRequest(input: Request, init: ByValue<KeepInit> | Fields<KeepInit>, error?: Ptr<DOMException | null>): Request;
  /**
   * @ntsSymbol keep_text
   * @ntsThrows error nts_dom_exception_take_message
   * @ntsNoEscape error
   */
  export function newRequest(input: StringView, init: ByValue<KeepInit> | Fields<KeepInit>, error?: Ptr<DOMException | null>): Request;
}
