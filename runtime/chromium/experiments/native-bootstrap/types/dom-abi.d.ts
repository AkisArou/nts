/** @ntsHeader "dom_abi.h" */
// The entered DOM ABI; the contract is documented in native/ffi/dom_abi.h.
// Handles are leases until compiler-managed release exists
// (contracts/compiler-requests.md, item 2): release each one you are given.
declare module "nts:chromium-dom" {
  import type { Opaque, StringView, c_int32, c_uint32 } from "c:types";
  export type DomContext = Opaque<"NtsDomContext">;
  export function nts_dom_intern(context: DomContext, text: StringView): c_uint32;
  export function nts_dom_release(context: DomContext, node: c_uint32): void;
  export function nts_dom_last_error(context: DomContext): c_int32;
  export function nts_dom_document(context: DomContext): c_uint32;
  export function nts_dom_query_atom(context: DomContext, root: c_uint32, selector: c_uint32): c_uint32;
  export function nts_dom_create_element(context: DomContext, tag: c_uint32): c_uint32;
  export function nts_dom_create_text(context: DomContext, text: StringView): c_uint32;
  export function nts_dom_clone(context: DomContext, node: c_uint32, deep: c_int32): c_uint32;
  export function nts_dom_first_child(context: DomContext, node: c_uint32): c_uint32;
  export function nts_dom_next_sibling(context: DomContext, node: c_uint32): c_uint32;
  export function nts_dom_append_child(context: DomContext, parent: c_uint32, child: c_uint32): c_int32;
  export function nts_dom_insert_before(context: DomContext, parent: c_uint32, child: c_uint32, reference: c_uint32): c_int32;
  export function nts_dom_remove_node(context: DomContext, node: c_uint32): c_int32;
  export function nts_dom_set_text_value(context: DomContext, node: c_uint32, text: StringView): c_int32;
  export function nts_dom_set_text_interned(context: DomContext, node: c_uint32, atom: c_uint32): c_int32;
  export function nts_dom_set_attribute_interned(context: DomContext, element: c_uint32, name: c_uint32, value: c_uint32): c_int32;
}
