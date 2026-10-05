/** @ntsHeader "dom_host.h" */
declare module "nts:chromium-dom-experiment" {
  import type { Opaque, CBytes, CElements, c_uint32, c_int32 } from "c:types";
  export type DomContext = Opaque<"NtsDomContext">;
  type Units = CElements<Uint16Array, "const uint16_t">;
  export function nts_dom_body(context: DomContext): c_uint32;
  /** @ntsNoEscape selector */
  export function nts_dom_query(context: DomContext, selector: Units, length: c_uint32): c_uint32;
  /** @ntsNoEscape name */
  export function nts_dom_element(context: DomContext, name: Units, length: c_uint32): c_uint32;
  /** @ntsNoEscape text */
  export function nts_dom_text(context: DomContext, text: Units, length: c_uint32): c_uint32;
  export function nts_dom_append(context: DomContext, parent: c_uint32, child: c_uint32): c_uint32;
  export function nts_dom_remove(context: DomContext, parent: c_uint32, child: c_uint32): c_uint32;
  /** @ntsNoEscape text */
  export function nts_dom_set_text(
    context: DomContext,
    node: c_uint32,
    text: Units,
    length: c_uint32,
  ): c_int32;
  /** @ntsNoEscape name value */
  export function nts_dom_set_attribute(
    context: DomContext,
    node: c_uint32,
    name: Units,
    nameLength: c_uint32,
    value: Units,
    valueLength: c_uint32,
  ): c_int32;
  // Entered operations: valid only inside a native entry; status per result.
  /** @ntsNoEscape text */
  export function nts_dom_set_text16(context: DomContext, node: c_uint32, text: Units, length: c_uint32): c_int32;
  /** @ntsNoEscape text */
  export function nts_dom_set_text8(context: DomContext, node: c_uint32, text: CBytes, length: c_uint32): c_int32;
  export function nts_dom_text_length(context: DomContext, node: c_uint32): c_uint32;
  /** @ntsNoEscape output */
  export function nts_dom_copy_text(
    context: DomContext,
    node: c_uint32,
    output: CElements<Uint16Array, "uint16_t">,
    capacity: c_uint32,
  ): c_int32;
  export function nts_dom_status(context: DomContext): c_int32;
  export function nts_dom_collect_for_testing(context: DomContext): void;
}
