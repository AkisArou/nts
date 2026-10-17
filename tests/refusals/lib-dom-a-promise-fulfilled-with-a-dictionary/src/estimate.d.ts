declare module "nts:dom" {
  import type { Struct } from "c:types";
  import type { Float64 } from "@nts/scalars";
  export type StorageEstimate = Struct<{ usage: Float64; quota: Float64 }, "NtsDomStorageEstimate">;
  export interface StorageManagerOwnMethods {
    /**
     * @ntsSymbol nts_dom_StorageManager_estimate
     */
    estimate(this: StorageManager): Promise<StorageEstimate>;
  }
}
