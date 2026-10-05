/** @ntsHeader "dom_host.h" */
// The benchmark's controls beside the DOM ABI; see native/ffi/dom_host.h.
declare module "nts:chromium-dom-experiment" {
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
