// react-gtk's libadwaita widgets (react-gtk/adw), driven directly on real
// widgets as native/gtk drives GTK's. Each logged line is one observable fact,
// and build.sh compares the log whole.
//
//   props     an Adw widget's own prop (a HeaderBar's showEndTitleButtons) and
//             one it inherits from GTK (cssClasses, through GtkWidget's
//             function) reach the widget
//   slot      an ApplicationWindow's Content slot element fills its content,
//             and taken out empties it
//   signal    an ActionRow's activated signal runs its handler
//   controlled  an EntryRow's text, from GTK's Editable, is controlled: a
//             user's edit goes back to the props' value when the app keeps it
//   application  an AdwApplication's root: an ApplicationWindow rendered there
//             joins the application at commit
//   group     a PreferencesGroup adds its rows in React's order: a row
//             inserted before its HeaderSuffix slot element goes before the
//             first row after it; a moved row and a removed one keep the order
//   toolbar   a ToolbarView's Top group holds a header bar, and its Content
//             slot its content
//   row       an ActionRow's Prefix and Suffix groups, and an ExpanderRow's
//             Prefix, place their widgets left to right in React's order
//   viewstack ViewStack.Page elements add named, titled pages; the
//             ViewStack's visibleChildName, applied before its pages existed,
//             shows the page it names; a title updates in place; switched from
//             GTK's side, the controlled page goes back to the props' one
//   dialog    an AlertDialog rendered in a Box is not placed in it: at commit
//             it is presented within the Box's window, and taken out it closes
//   unknown   a root without the adw set creates no Adw widget
//   reset     removing the Adw prop restores libadwaita's default, and
//             removing the inherited GTK one clears it

import {
  AdwActionRow,
  adw_init,
  AdwApplication,
  AdwApplicationWindow,
  AdwEntryRow,
  AdwHeaderBar,
  AdwPreferencesGroup,
  AdwToolbarView,
  AdwViewStack,
  AdwWindow,
} from "c:Adw-1";
import { ApplicationFlags } from "c:Gio-2.0";
import { g_main_context_iteration } from "c:GLib-2.0";
import { GtkWindow, type GtkWidget } from "c:Gtk-4.0";
import { react_gtk_emit, react_gtk_log } from "c:react-gtk-shim";
import { setAfterEvent } from "../../../packages/react-gtk/src/HostNode.ts";
import { adw } from "../../../packages/react-gtk/src/adw/index.ts";
import {
  ApplicationRoot,
  appendChildToContainer,
  appendInitialChild,
  commitMount,
  commitUpdate,
  createInstance,
  finalizeInitialChildren,
  getPublicInstance,
  insertBefore,
  type HostNode,
  removeChild,
  removeChildFromContainer,
  WindowRoot,
} from "../../../packages/react-gtk/src/ReactFiberConfig.ts";

function widget(node: HostNode): GtkWidget {
  return getPublicInstance(node);
}

// Runs what the main loop has ready: controlled props are put back from it.
function idle(): void {
  while (g_main_context_iteration(null, false)) {
    // until nothing is ready
  }
}

function main(): void {
  adw_init();
  const root = new WindowRoot(new GtkWindow(), [adw]);

  const bar = createInstance("AdwHeaderBar", { showEndTitleButtons: false, cssClasses: ["flat"] }, root, 0, {});
  const barWidget = widget(bar);
  react_gtk_log(
    "props " +
      String(barWidget instanceof AdwHeaderBar && !barWidget.get_show_end_title_buttons()) +
      " " +
      String(barWidget.has_css_class("flat")),
  );

  const window = createInstance("AdwApplicationWindow", {}, root, 0, {});
  const content = createInstance("AdwApplicationWindow.Content", {}, root, 0, {});
  const label = createInstance("GtkLabel", { label: "content" }, root, 0, {});
  appendInitialChild(content, label);
  appendInitialChild(window, content);
  const windowWidget = widget(window);
  const filled = windowWidget instanceof AdwApplicationWindow && windowWidget.get_content() === widget(label);
  removeChild(window, content);
  const emptied = windowWidget instanceof AdwApplicationWindow && windowWidget.get_content() === null;
  react_gtk_log("slot " + String(filled) + " " + String(emptied));

  let activations = 0;
  const row = createInstance("AdwActionRow", { title: "Row", onActivated: () => activations++ }, root, 0, {});
  const rowWidget = widget(row);
  if (rowWidget instanceof AdwActionRow) {
    react_gtk_emit(rowWidget, "activated");
  }
  react_gtk_log("signal " + String(activations));

  // The app keeps its state: nothing is flushed, so the text goes back.
  setAfterEvent(() => {});
  const entry = createInstance("AdwEntryRow", { text: "kept" }, root, 0, {});
  const entryWidget = widget(entry);
  if (entryWidget instanceof AdwEntryRow) {
    entryWidget.set_text("typed");
  }
  idle();
  react_gtk_log("controlled " + (entryWidget instanceof AdwEntryRow ? entryWidget.get_text() : "not an entry row"));

  const group = createInstance("AdwPreferencesGroup", { title: "Group" }, root, 0, {});
  const rows: HostNode[] = [];
  const rowNames = ["A", "B", "X"];
  for (const name of rowNames) {
    rows.push(createInstance("AdwActionRow", { title: name }, root, 0, {}));
  }
  const suffixSlot = createInstance("AdwPreferencesGroup.HeaderSuffix", {}, root, 0, {});
  const suffix = createInstance("GtkButton", { label: "more" }, root, 0, {});
  appendInitialChild(suffixSlot, suffix);
  appendInitialChild(group, rows[0]!);
  appendInitialChild(group, suffixSlot);
  appendInitialChild(group, rows[1]!);
  const groupWidget = widget(group);
  const rowOrder = (): string => {
    if (!(groupWidget instanceof AdwPreferencesGroup)) {
      return "not a group";
    }
    let order = "";
    for (let i = 0; ; i++) {
      const row = groupWidget.get_row(i);
      if (row === null) {
        break;
      }
      for (let r = 0; r < rows.length; r++) {
        if (widget(rows[r]!) === row) {
          order += (order === "" ? "" : ",") + rowNames[r]!;
        }
      }
    }
    return order;
  };
  insertBefore(group, rows[2]!, suffixSlot);
  let grouping = rowOrder();
  insertBefore(group, rows[1]!, rows[0]!);
  grouping += " " + rowOrder();
  removeChild(group, rows[0]!);
  grouping += " " + rowOrder();
  const suffixed = groupWidget instanceof AdwPreferencesGroup && groupWidget.get_header_suffix() === widget(suffix);
  react_gtk_log("group " + grouping + " suffix=" + String(suffixed));

  const view = createInstance("AdwToolbarView", {}, root, 0, {});
  const top = createInstance("AdwToolbarView.Top", {}, root, 0, {});
  const topBar = createInstance("AdwHeaderBar", {}, root, 0, {});
  const viewContent = createInstance("AdwToolbarView.Content", {}, root, 0, {});
  const page = createInstance("GtkLabel", { label: "page" }, root, 0, {});
  appendInitialChild(top, topBar);
  appendInitialChild(viewContent, page);
  appendInitialChild(view, top);
  appendInitialChild(view, viewContent);
  const viewWidget = widget(view);
  const hasContent = viewWidget instanceof AdwToolbarView && viewWidget.get_content() === widget(page);
  const barPlaced = widget(topBar).get_parent() !== null;
  react_gtk_log("toolbar " + String(barPlaced) + " " + String(hasContent));

  const sided = createInstance("AdwActionRow", { title: "Sides" }, root, 0, {});
  const prefix = createInstance("AdwActionRow.Prefix", {}, root, 0, {});
  const suffixes = createInstance("AdwActionRow.Suffix", {}, root, 0, {});
  const sides: HostNode[] = [];
  const sideNames = ["p1", "p2", "s1", "s2"];
  for (const name of sideNames) {
    sides.push(createInstance("GtkLabel", { label: name }, root, 0, {}));
  }
  appendInitialChild(prefix, sides[0]!);
  appendInitialChild(prefix, sides[1]!);
  appendInitialChild(suffixes, sides[2]!);
  appendInitialChild(suffixes, sides[3]!);
  appendInitialChild(sided, prefix);
  appendInitialChild(sided, suffixes);
  const nextOf = (i: number): string => {
    const next = widget(sides[i]!).get_next_sibling();
    for (let n = 0; n < sides.length; n++) {
      if (next === widget(sides[n]!)) {
        return sideNames[n]!;
      }
    }
    return next === null ? "-" : "?";
  };
  const expander = createInstance("AdwExpanderRow", { title: "More" }, root, 0, {});
  const expanderPrefix = createInstance("AdwExpanderRow.Prefix", {}, root, 0, {});
  const e1 = createInstance("GtkLabel", { label: "e1" }, root, 0, {});
  const e2 = createInstance("GtkLabel", { label: "e2" }, root, 0, {});
  appendInitialChild(expanderPrefix, e1);
  appendInitialChild(expanderPrefix, e2);
  appendInitialChild(expander, expanderPrefix);
  const expanderOrder = widget(e1).get_next_sibling() === widget(e2) ? "e1>e2" : "e1>?";
  react_gtk_log("row " + sideNames[0]! + ">" + nextOf(0) + " " + sideNames[2]! + ">" + nextOf(2) + " " + expanderOrder);

  const stack = createInstance("AdwViewStack", { visibleChildName: "b" }, root, 0, {});
  const pageA = createInstance("AdwViewStack.Page", { name: "a", title: "A" }, root, 0, {});
  const pageB = createInstance("AdwViewStack.Page", { name: "b", title: "B" }, root, 0, {});
  const onA = createInstance("GtkLabel", { label: "a" }, root, 0, {});
  const onB = createInstance("GtkLabel", { label: "b" }, root, 0, {});
  appendInitialChild(pageA, onA);
  appendInitialChild(pageB, onB);
  appendInitialChild(stack, pageA);
  appendInitialChild(stack, pageB);
  const stackWidget = widget(stack);
  const views = stackWidget instanceof AdwViewStack ? stackWidget : null;
  let viewing = "not a view stack";
  if (views !== null) {
    viewing = String(views.get_visible_child_name()) + " " + String(views.get_page(widget(onB)).get_title());
    commitUpdate(pageB, "AdwViewStack.Page", { name: "b", title: "B" }, { name: "b", title: "Bee" }, {});
    viewing += ">" + String(views.get_page(widget(onB)).get_title());
    views.set_visible_child_name("a");
    idle();
    viewing += " switched=" + String(views.get_visible_child_name());
  }
  react_gtk_log("viewstack " + viewing);

  // A dialog is presented within a shown libadwaita window, as an app's is
  // (over a plain GtkWindow, libadwaita opens it as a window of its own).
  const adwWindow = new AdwWindow();
  const shown = new WindowRoot(adwWindow, [adw]);
  const anchor = createInstance("GtkBox", {}, shown, 0, {});
  adwWindow.set_content(widget(anchor));
  adwWindow.set_default_size(640, 480);
  adwWindow.present();
  idle();
  const dialog = createInstance("AdwAlertDialog", { heading: "Sure?" }, shown, 0, {});
  const dialogWantsMount = finalizeInitialChildren(dialog, "AdwAlertDialog", { heading: "Sure?" }, 0);
  appendInitialChild(anchor, dialog);
  const unplaced = widget(dialog).get_root() === null;
  commitMount(dialog, "AdwAlertDialog", { heading: "Sure?" }, {});
  idle();
  const within = widget(dialog).get_root() === shown.window;
  removeChild(anchor, dialog);
  idle();
  const closed = widget(dialog).get_root() === null;
  react_gtk_log("dialog " + String(dialogWantsMount) + " " + String(unplaced) + " " + String(within) + " " + String(closed));

  const application = new AdwApplication({ application_id: "org.nts.ReactAdw", flags: ApplicationFlags.NON_UNIQUE });
  application.register(null, null);
  const appRoot = new ApplicationRoot(application, [adw]);
  const appWindow = createInstance("AdwApplicationWindow", { title: "App" }, appRoot, 0, {});
  const wantsMount = finalizeInitialChildren(appWindow, "AdwApplicationWindow", { title: "App" }, 0);
  appendChildToContainer(appRoot, appWindow);
  commitMount(appWindow, "AdwApplicationWindow", { title: "App" }, {});
  const appWidget = widget(appWindow);
  const joined = appWidget instanceof GtkWindow && appWidget.get_application() === application;
  removeChildFromContainer(appRoot, appWindow);
  react_gtk_log("application " + String(wantsMount) + " " + String(joined));

  const gtkOnly = new WindowRoot(new GtkWindow(), []);
  react_gtk_log("unknown " + String(gtkOnly.createNode("AdwHeaderBar") === null) + " " + String(gtkOnly.createNode("GtkLabel") !== null));

  commitUpdate(bar, "AdwHeaderBar", { showEndTitleButtons: false, cssClasses: ["flat"] }, {}, {});
  react_gtk_log("reset " + String(barWidget instanceof AdwHeaderBar && barWidget.get_show_end_title_buttons()) + " " + String(!barWidget.has_css_class("flat")));
}

main();
