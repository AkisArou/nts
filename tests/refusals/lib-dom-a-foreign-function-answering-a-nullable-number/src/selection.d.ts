declare module "nts:dom" {
  import type { Float64 } from "@nts/scalars";
  export interface HTMLInputElementOwnMethods {
    /**
     * @ntsSymbol nts_dom_HTMLInputElement_get_selectionStart
     */
    _get_selectionStart(this: HTMLInputElement): Float64 | null;
    /**
     * @ntsGet _get_selectionStart
     */
    selectionStart: Float64 | null;
  }
}
