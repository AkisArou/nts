declare module "nts:dom" {
  import type { Closure } from "c:types";
  import type { Float64 } from "@nts/scalars";
  export interface DocumentOwnMethods {
    /**
     * @ntsSymbol nts_dom_Document_createNodeIterator_3
     */
    createNodeIterator(this: Document, root: Node, whatToShow: Float64, filter: Closure<(node: Node) => Float64>): NodeIterator;
  }
}
