declare module "nts:dom" {
  import type { ByValue, CBool, StringView, Struct } from "c:types";
  import type { Uint8 } from "@nts/scalars";
  export type CanvasRenderingContext2DSettings = Struct<{ desynchronized: CBool<Uint8>; colorSpace: StringView }, "NtsDomCanvasRenderingContext2DSettings">;
  export interface CanvasRenderingContext2DOwnMethods {
    /**
     * @ntsSymbol nts_dom_CanvasRenderingContext2D_getContextAttributes
     */
    getContextAttributes(this: CanvasRenderingContext2D): ByValue<CanvasRenderingContext2DSettings>;
  }
}
