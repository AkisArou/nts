/** @ntsHeader "dom_testing.h" */
// What tests and benchmarks ask of the adapter beside the DOM itself; see
// abi/dom_testing.h. Not for applications.
declare module "nts:dom-testing" {
  import type { CBytes, CElements, StringView, c_int32, c_uint32 } from "c:types";
  import type { Node } from "nts:dom";
  type Units = CElements<Uint16Array, "const uint16_t">;
  /** @ntsNoEscape text */
  export function nts_dom_set_text16(node: Node, text: Units, length: c_uint32): c_int32;
  /** @ntsNoEscape text */
  export function nts_dom_set_text8(node: Node, text: CBytes, length: c_uint32): c_int32;
  export function nts_dom_intern(text: StringView): c_uint32;
  export function nts_dom_set_text_interned(node: Node, atom: c_uint32): c_int32;
  export function nts_dom_collect_for_testing(): void;
}
