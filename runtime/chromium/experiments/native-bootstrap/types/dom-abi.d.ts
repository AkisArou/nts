/** @ntsHeader "dom_abi.h" */
// The entered DOM ABI; the contract is documented in native/ffi/dom_abi.h.
// Nodes are the Blink nodes themselves: one the program keeps is rooted by
// the compiler (`HostClass`), and one it only passes along costs nothing.
declare module "nts:chromium-dom" {
  import type { Closure, HostClass, Opaque, StringView, c_int32, c_uint32 } from "c:types";
  export type DomContext = Opaque<"NtsDomContext">;
  export type Node = HostClass<"NtsDomNode", null, "nts_dom_retain", "nts_dom_release">;
  export type Element = HostClass<"NtsDomElement", Node>;
  export type Text = HostClass<"NtsDomText", Node>;
  export type Document = HostClass<"NtsDomDocument", Node>;
  export type Listener = HostClass<"NtsDomListener", null, "nts_dom_listener_retain", "nts_dom_listener_release">;
  export function nts_dom_last_error(context: DomContext): c_int32;
  export function nts_dom_document(context: DomContext): Document | null;
  export function nts_dom_query(context: DomContext, root: Node, selectors: StringView): Element | null;
  export function nts_dom_create_element(context: DomContext, tag: StringView): Element | null;
  export function nts_dom_create_text(context: DomContext, text: StringView): Text | null;
  export function nts_dom_clone(context: DomContext, node: Node, deep: c_int32): Node | null;
  export function nts_dom_clone_element(context: DomContext, element: Element, deep: c_int32): Element | null;
  export function nts_dom_first_child(context: DomContext, node: Node): Node | null;
  export function nts_dom_next_sibling(context: DomContext, node: Node): Node | null;
  export function nts_dom_as_element(context: DomContext, node: Node): Element | null;
  export function nts_dom_as_text(context: DomContext, node: Node): Text | null;
  export function nts_dom_append_child(context: DomContext, parent: Node, child: Node): c_int32;
  export function nts_dom_insert_before(context: DomContext, parent: Node, child: Node, reference: Node | null): c_int32;
  export function nts_dom_remove_child(context: DomContext, parent: Node, child: Node): c_int32;
  export function nts_dom_remove(context: DomContext, node: Node): c_int32;
  export function nts_dom_set_text_content(context: DomContext, node: Node, text: StringView): c_int32;
  export function nts_dom_set_attribute(context: DomContext, element: Element, name: StringView, value: StringView): c_int32;
  export function nts_dom_text_content(context: DomContext, node: Node): StringView | null;
  export function nts_dom_get_attribute(context: DomContext, element: Element, name: StringView): StringView | null;
  export function nts_dom_listen(context: DomContext, target: Node, type: StringView, listener: Closure<(target: Node) => void>): Listener | null;
  export function nts_dom_unlisten(context: DomContext, listener: Listener): c_int32;
  export function nts_dom_click(context: DomContext, element: Element): c_int32;
  export function nts_dom_intern(context: DomContext, text: StringView): c_uint32;
  export function nts_dom_set_text_interned(context: DomContext, node: Node, atom: c_uint32): c_int32;
}
