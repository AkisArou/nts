declare module "x:host" {
  import type { HostClass, c_int } from "c:types";
  export type Widget = HostClass<"XWidget", null, "x_widget_retain", "x_widget_release">;
  /** @ntsSymbol x_widget_ready */
  export function ready(): Promise<Widget>;
  /** @ntsSymbol x_widget_id */
  export function id(widget: Widget): c_int;
}
