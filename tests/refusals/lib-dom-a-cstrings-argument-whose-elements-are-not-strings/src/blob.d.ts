declare module "nts:dom" {
  import type { CStrings, Counted } from "c:types";
  import type { c_size_t } from "@nts/scalars";
  /**
   * @ntsSymbol nts_dom_new_Blob_s
   * @ntsNoEscape blobParts
   */
  export function newBlob(blobParts: Counted<CStrings, c_size_t>): Blob;
}
