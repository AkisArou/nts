/** @ntsHeader "dom_testing.h" */
// What tests and benchmarks ask of the adapter beside the DOM itself; see
// abi/dom_testing.h. Not for applications.
declare module "nts:dom-testing" {
  import type { CBytes, CElements, StringView } from "c:types";
  import type { Int32, Uint32 } from "@nts/scalars";
  import type { Node } from "nts:dom";
  type Units = CElements<Uint16Array, "const uint16_t">;
  /** @ntsNoEscape text */
  export function nts_dom_set_text16(node: Node, text: Units, length: Uint32): Int32;
  /** @ntsNoEscape text */
  export function nts_dom_set_text8(node: Node, text: CBytes, length: Uint32): Int32;
  export function nts_dom_intern(text: StringView): Uint32;
  export function nts_dom_set_text_interned(node: Node, atom: Uint32): Int32;
  export function nts_dom_collect_for_testing(): void;
}
