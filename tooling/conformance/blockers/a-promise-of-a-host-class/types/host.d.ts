declare module "x:host" {
  import type { HostClass } from "c:types";
  import type { c_int } from "@nts/scalars";
  export type Widget = HostClass<"XWidget", null, "x_widget_retain", "x_widget_release">;
  /** @ntsSymbol x_widget_ready */
  export function ready(): Promise<Widget>;
  /** @ntsSymbol x_widget_id */
  export function id(widget: Widget): c_int;
}
