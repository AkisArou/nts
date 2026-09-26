// react-gtk/adw: libadwaita's widgets as React host components, beside GTK's.
//
//   import { ApplicationWindow, HeaderBar, ToolbarView, adw } from "react-gtk/adw";
//   createApplicationRoot(app, { widgets: [adw] }).render(
//     <ApplicationWindow title="Hello">...</ApplicationWindow>,
//   );
//
// A root creates only the widgets it is given, so an app that does not import
// this module does not link libadwaita. The widgets are generated from
// Adw-1.gir and its bindings, as GTK's are (tools/gen-widgets.ts --namespace
// Adw-1); their names are libadwaita's without the `Adw` prefix, so an app that
// uses both imports one set under other names.

import { WidgetSet } from "../HostNode.ts";
import { createNode } from "./widgets.ts";

export * from "./widgets.ts";

/** libadwaita's widgets, for a root's `widgets`. */
export const adw: WidgetSet = new WidgetSet("adw", createNode);
