declare module "nts:dom" {
  import type { CElements, Counted } from "c:types";
  import type { c_size_t } from "@nts/scalars";
  export interface DOMMatrixReadOnlyOwnMethods {
    /**
     * @ntsSymbol nts_dom_DOMMatrixReadOnly_toFloat64Array
     */
    toFloat64Array(this: DOMMatrixReadOnly): Float64Array;
  }
  /**
   * @ntsSymbol nts_dom_DOMMatrix_fromFloat64Array
   * @ntsNoEscape array
   */
  export function DOMMatrix_fromFloat64Array(array: Counted<CElements<Float64Array, "const double">, c_size_t>): DOMMatrix;
}
