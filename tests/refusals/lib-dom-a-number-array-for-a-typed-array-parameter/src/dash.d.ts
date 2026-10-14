declare module "nts:dom" {
  import type { CElements, Counted } from "c:types";
  import type { c_size_t } from "@nts/scalars";
  export interface CanvasRenderingContext2DOwnMethods {
    /**
     * @ntsSymbol nts_dom_CanvasRenderingContext2D_setLineDash
     * @ntsNoEscape segments
     */
    setLineDash(this: CanvasRenderingContext2D, segments: Counted<CElements<Float64Array, "const double">, c_size_t>): void;
  }
}
