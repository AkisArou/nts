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
//             user's edit goes back to the props' value when the app keeps it;
//             so do a SwitchRow's active, an ExpanderRow's expanded, a
//             SpinRow's value, a ComboRow's selected, an OverlaySplitView's
//             sidebar, a NavigationSplitView's content, a BottomSheet's open
//             and a TabOverview's open
//   application  an AdwApplication's root: an ApplicationWindow rendered there
//             joins the application at commit
//   group     a PreferencesGroup adds its rows in React's order: a row
//             inserted before its HeaderSuffix slot element goes before the
//             first row after it; a moved row and a removed one keep the order
//   toolbar   a ToolbarView's Top group holds a header bar, and its Content
//             slot its content
//   row       an ActionRow's Prefix and Suffix groups, an ExpanderRow's
//             Prefix, and an EntryRow's Prefix and Suffix, place their widgets
//             left to right in React's order
//   viewstack ViewStack.Page elements add named, titled pages; the
//             ViewStack's visibleChildName, applied before its pages existed,
//             shows the page it names; a title updates in place; switched from
//             GTK's side, the controlled page goes back to the props' one
//   switcher  a ViewSwitcher's `stack` names the ViewStack rendered beside it,
//             and removing the prop unsets it
//   split     a NavigationSplitView's Sidebar and Content slot elements fill
//             its pages with the NavigationPages they hold; taken out, the
//             sidebar is empty
//   tabs      TabView.Page elements add titled tabs in React's order, one
//             inserted before another and one moved; the moved tab stays
//             selected; a close the user asks for is refused and reported
//             as onClose, and taking the element out closes the tab; the
//             TabView's onPageAttached hears each tab's page and position; a
//             tab's `selected` selects it, the user selecting another is
//             heard as that tab's onSelect and put back after the flush, and
//             the app moving `selected` moves the selection
//   pinned    a pinned tab goes before the unpinned ones whatever React's
//             order; unpinned, it goes where React's order puts it; a tab
//             pinned later goes last among the pinned; an unpinned tab moved
//             before an unpinned one stays after the pinned; a pinned tab
//             React takes out closes
//   carousel  a Carousel's pages in React's order: appended, one inserted,
//             moved forward, back and to the end, and one removed
//   navigation  a NavigationView's children are its stack, the last shown:
//             one more is pushed, the last taken off is popped, a reorder
//             replaces the stack; the user going back is heard as onPopped,
//             and the page comes back unless the app takes it away
//   toggles   a ToggleGroup's Toggle elements in React's order; its
//             activeName, applied before its toggles existed, selects the one
//             it names; a user's pick goes back when the app keeps its own; a
//             label updates in place; one taken out goes
//   dialog    an AlertDialog rendered in a Box is not placed in it: at commit
//             it is presented within the Box's window; its Response
//             elements are its buttons in React's order, one inserted between
//             two goes between them and updates in place; its onResponse hears
//             the response id, and taken out it closes, which onResponse
//             does not hear
//   preferences  a PreferencesDialog's children are its pages, added to it
//             and not made its content: the first is shown, another taken out
//             leaves it
//   toasts    a ToastOverlay's Toast elements show while rendered: one React
//             takes out is dismissed unheard; the user dismissing one is heard
//   breakpoints  a BreakpointBin's Breakpoint elements: of those whose
//             condition holds, the last applies, heard as onApply and the
//             other's onUnapply; a condition from props moves it; a
//             breakpoint React takes out is removed and not heard, and the
//             one before it applies again
//   window-breakpoint  a Window's Breakpoint applies; taken out, it is
//             disarmed (a window cannot remove one) and not heard; placed
//             again, it applies again
//   unknown   a root without the adw set creates no Adw widget
//   reset     removing the Adw prop restores libadwaita's default, and
//             removing the inherited GTK one clears it

import {
  AdwActionRow,
  AdwAlertDialog,
  adw_init,
  AdwApplication,
  AdwApplicationWindow,
  AdwBottomSheet,
  AdwCarousel,
  AdwComboRow,
  AdwEntryRow,
  AdwExpanderRow,
  AdwHeaderBar,
  AdwNavigationSplitView,
  AdwNavigationView,
  AdwOverlaySplitView,
  AdwPreferencesDialog,
  AdwPreferencesGroup,
  AdwSpinRow,
  AdwSwitchRow,
  AdwTabOverview,
  AdwTabView,
  AdwToastOverlay,
  AdwToggleGroup,
  type AdwTabPage,
  AdwToolbarView,
  AdwViewStack,
  AdwViewSwitcher,
  AdwWindow,
} from "c:Adw-1";
import { ApplicationFlags } from "c:Gio-2.0";
import { g_main_context_iteration, g_main_loop_new, g_timeout_add_full } from "c:GLib-2.0";
import { GtkAdjustment, GtkButton, GtkLabel, GtkStringList, GtkWindow, type GtkWidget } from "c:Gtk-4.0";
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
  type Props,
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

// The labels of the buttons in `widget`'s tree, in the tree's order: an
// AlertDialog's responses, which it has no getter for the order of.
function buttonLabels(widget: GtkWidget, into: string[]): void {
  if (widget instanceof GtkButton) {
    const label = widget.get_label();
    if (label !== null) {
      into.push(label);
    }
  }
  for (let child = widget.get_first_child(); child !== null; child = child.get_next_sibling()) {
    buttonLabels(child, into);
  }
}

// Runs the main loop for `ms`: what waits on the frame clock, as a layout
// pass does, has run by the end.
function settle(ms: number): void {
  const loop = g_main_loop_new(null, false);
  g_timeout_add_full(0, ms, () => {
    loop.quit();
    return false;
  });
  loop.run();
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
  // libadwaita's other inputs, each changed as a user would: each goes back.
  const switchRow = createInstance("AdwSwitchRow", { title: "Wi-Fi", active: false }, root, 0, {});
  const expanderRow = createInstance("AdwExpanderRow", { title: "More", expanded: false }, root, 0, {});
  const range = new GtkAdjustment();
  range.set_upper(10);
  range.set_step_increment(1);
  const spinRow = createInstance("AdwSpinRow", { title: "Count", adjustment: range, value: 3 }, root, 0, {});
  const choices = new GtkStringList();
  choices.append("a");
  choices.append("b");
  const comboRow = createInstance("AdwComboRow", { title: "Choice", model: choices, selected: 0 }, root, 0, {});
  const overlaySplit = createInstance("AdwOverlaySplitView", { showSidebar: true }, root, 0, {});
  const navigationSplit = createInstance("AdwNavigationSplitView", { showContent: false }, root, 0, {});
  const sheet = createInstance("AdwBottomSheet", { open: false }, root, 0, {});
  // An overview opens on a view with pages: libadwaita warns about an empty one.
  const overviewView = new AdwTabView();
  overviewView.append(new GtkLabel());
  const overview = createInstance("AdwTabOverview", { view: overviewView, open: true }, root, 0, {});
  const switchWidget = widget(switchRow);
  const expanderWidget = widget(expanderRow);
  const spinWidget = widget(spinRow);
  const comboWidget = widget(comboRow);
  const overlayWidget = widget(overlaySplit);
  const navigationWidget = widget(navigationSplit);
  const sheetWidget = widget(sheet);
  const overviewWidget = widget(overview);
  if (switchWidget instanceof AdwSwitchRow) switchWidget.set_active(true);
  if (expanderWidget instanceof AdwExpanderRow) expanderWidget.set_expanded(true);
  if (spinWidget instanceof AdwSpinRow) spinWidget.set_value(5);
  if (comboWidget instanceof AdwComboRow) comboWidget.set_selected(1);
  if (overlayWidget instanceof AdwOverlaySplitView) overlayWidget.set_show_sidebar(false);
  if (navigationWidget instanceof AdwNavigationSplitView) navigationWidget.set_show_content(true);
  if (sheetWidget instanceof AdwBottomSheet) sheetWidget.set_open(true);
  if (overviewWidget instanceof AdwTabOverview) overviewWidget.set_open(false);
  idle();
  const inputs =
    String(switchWidget instanceof AdwSwitchRow && switchWidget.get_active()) +
    " " +
    String(expanderWidget instanceof AdwExpanderRow && expanderWidget.get_expanded()) +
    " " +
    String(spinWidget instanceof AdwSpinRow ? spinWidget.get_value() : -1) +
    " " +
    String(comboWidget instanceof AdwComboRow ? comboWidget.get_selected() : -1) +
    " " +
    String(overlayWidget instanceof AdwOverlaySplitView && overlayWidget.get_show_sidebar()) +
    " " +
    String(navigationWidget instanceof AdwNavigationSplitView && navigationWidget.get_show_content()) +
    " " +
    String(sheetWidget instanceof AdwBottomSheet && sheetWidget.get_open()) +
    " " +
    String(overviewWidget instanceof AdwTabOverview && overviewWidget.get_open());
  react_gtk_log("controlled " + (entryWidget instanceof AdwEntryRow ? entryWidget.get_text() : "not an entry row") + " " + inputs);

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
  // Moved to the end, as React appends a keyed row again.
  appendInitialChild(group, rows[1]!);
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
  const entryRow = createInstance("AdwEntryRow", { title: "Name" }, root, 0, {});
  const entryPrefix = createInstance("AdwEntryRow.Prefix", {}, root, 0, {});
  const entrySuffix = createInstance("AdwEntryRow.Suffix", {}, root, 0, {});
  const entrySides: HostNode[] = [];
  for (const name of ["r1", "r2", "t1", "t2"]) {
    entrySides.push(createInstance("GtkLabel", { label: name }, root, 0, {}));
  }
  appendInitialChild(entryPrefix, entrySides[0]!);
  appendInitialChild(entryPrefix, entrySides[1]!);
  appendInitialChild(entrySuffix, entrySides[2]!);
  appendInitialChild(entrySuffix, entrySides[3]!);
  appendInitialChild(entryRow, entryPrefix);
  appendInitialChild(entryRow, entrySuffix);
  const follows = (first: HostNode, second: HostNode): boolean => widget(first).get_next_sibling() === widget(second);
  const entryOrder =
    (follows(entrySides[0]!, entrySides[1]!) ? "r1>r2" : follows(entrySides[1]!, entrySides[0]!) ? "r2>r1" : "r?") +
    " " +
    (follows(entrySides[2]!, entrySides[3]!) ? "t1>t2" : follows(entrySides[3]!, entrySides[2]!) ? "t2>t1" : "t?");
  react_gtk_log("row " + sideNames[0]! + ">" + nextOf(0) + " " + sideNames[2]! + ">" + nextOf(2) + " " + expanderOrder + " " + entryOrder);

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

  const switcher = createInstance("AdwViewSwitcher", { stack: stackWidget }, root, 0, {});
  const switcherWidget = widget(switcher);
  let switching = "not a view switcher";
  if (switcherWidget instanceof AdwViewSwitcher) {
    switching = String(switcherWidget.get_stack() === stackWidget);
    commitUpdate(switcher, "AdwViewSwitcher", { stack: stackWidget }, {}, {});
    switching += " " + String(switcherWidget.get_stack() === null);
  }
  react_gtk_log("switcher " + switching);

  const split = createInstance("AdwNavigationSplitView", {}, root, 0, {});
  const sidebar = createInstance("AdwNavigationSplitView.Sidebar", {}, root, 0, {});
  const splitContent = createInstance("AdwNavigationSplitView.Content", {}, root, 0, {});
  const folders = createInstance("AdwNavigationPage", { title: "Folders" }, root, 0, {});
  const inbox = createInstance("AdwNavigationPage", { title: "Inbox" }, root, 0, {});
  appendInitialChild(sidebar, folders);
  appendInitialChild(splitContent, inbox);
  appendInitialChild(split, sidebar);
  appendInitialChild(split, splitContent);
  const splitWidget = widget(split);
  let splitting = "not a split view";
  if (splitWidget instanceof AdwNavigationSplitView) {
    splitting = String(splitWidget.get_sidebar() === widget(folders)) + " " + String(splitWidget.get_content() === widget(inbox));
    removeChild(split, sidebar);
    splitting += " " + String(splitWidget.get_sidebar() === null);
  }
  react_gtk_log("split " + splitting);

  let attachedAt = "";
  let lastAttached: AdwTabPage | null = null;
  const onPageAttached = (page: AdwTabPage, position: number): void => {
    attachedAt += String(position);
    lastAttached = page;
  };
  const tabView = createInstance("AdwTabView", { onPageAttached }, root, 0, {});
  let asked = 0;
  const tabs: HostNode[] = [];
  for (const title of ["A", "B", "C", "D"]) {
    const tab = createInstance("AdwTabView.Page", { title, onClose: () => asked++ }, root, 0, {});
    appendInitialChild(tab, createInstance("GtkLabel", { label: title }, root, 0, {}));
    tabs.push(tab);
  }
  appendInitialChild(tabView, tabs[0]!);
  appendInitialChild(tabView, tabs[1]!);
  appendInitialChild(tabView, tabs[2]!);
  const tabWidget = widget(tabView);
  const tabbed = tabWidget instanceof AdwTabView ? tabWidget : null;
  let tabbing = "not a tab view";
  if (tabbed !== null) {
    const titles = (): string => {
      let all = "";
      for (let i = 0; i < tabbed.get_n_pages(); i++) {
        all += (i === 0 ? "" : ",") + tabbed.get_nth_page(i).get_title();
      }
      return all;
    };
    tabbing = titles();
    insertBefore(tabView, tabs[3]!, tabs[1]!);
    tabbing += ">" + titles();
    const pageOf = (tab: HostNode) => tabbed.get_page(getPublicInstance(tab));
    tabbed.set_selected_page(pageOf(tabs[2]!));
    insertBefore(tabView, tabs[2]!, tabs[0]!);
    tabbing += ">" + titles() + " selected=" + String(tabbed.get_selected_page() === pageOf(tabs[2]!));
    tabbed.close_page(pageOf(tabs[3]!));
    tabbing += " asked=" + String(asked) + " kept=" + String(tabbed.get_n_pages());
    tabbing += " attached=" + attachedAt + " " + String(lastAttached === pageOf(tabs[3]!));
    let heard = "";
    const tabProps = (title: string, selected: boolean): Props => ({
      title,
      selected,
      onClose: () => asked++,
      onSelect: () => {
        heard += title;
      },
    });
    const selectedTitle = (): string => {
      const page = tabbed.get_selected_page();
      return page === null ? "-" : page.get_title();
    };
    commitUpdate(tabs[0]!, "AdwTabView.Page", { title: "A" }, tabProps("A", true), {});
    commitUpdate(tabs[1]!, "AdwTabView.Page", { title: "B" }, tabProps("B", false), {});
    tabbing += " selected=" + selectedTitle();
    tabbed.set_selected_page(pageOf(tabs[1]!));
    const picked = selectedTitle();
    idle();
    tabbing += " user=" + picked + ">" + selectedTitle() + " heard=" + heard;
    commitUpdate(tabs[0]!, "AdwTabView.Page", tabProps("A", true), tabProps("A", false), {});
    commitUpdate(tabs[1]!, "AdwTabView.Page", tabProps("B", false), tabProps("B", true), {});
    tabbing += " app=" + selectedTitle() + " heard=" + heard;
    removeChild(tabView, tabs[3]!);
    tabbing += " " + titles();
  }
  react_gtk_log("tabs " + tabbing);

  const pinView = createInstance("AdwTabView", {}, root, 0, {});
  const pinTabs: HostNode[] = [];
  for (const name of ["A", "P", "B"]) {
    const tab = createInstance("AdwTabView.Page", { title: name, pinned: name === "P" }, root, 0, {});
    appendInitialChild(tab, createInstance("GtkLabel", { label: name }, root, 0, {}));
    pinTabs.push(tab);
    appendInitialChild(pinView, tab);
  }
  const pinWidget = widget(pinView);
  const pinning = pinWidget instanceof AdwTabView ? pinWidget : null;
  let pinned = "not a tab view";
  if (pinning !== null) {
    const order = (): string => {
      let all = "";
      for (let i = 0; i < pinning.get_n_pages(); i++) {
        const page = pinning.get_nth_page(i);
        all += page.get_title() + (page.get_pinned() ? "*" : "");
      }
      return all;
    };
    pinned = order();
    commitUpdate(pinTabs[1]!, "AdwTabView.Page", { title: "P", pinned: true }, { title: "P" }, {});
    pinned += ">" + order();
    commitUpdate(pinTabs[2]!, "AdwTabView.Page", { title: "B" }, { title: "B", pinned: true }, {});
    pinned += ">" + order();
    insertBefore(pinView, pinTabs[1]!, pinTabs[0]!);
    pinned += ">" + order();
    removeChild(pinView, pinTabs[2]!);
    pinned += ">" + order();
  }
  react_gtk_log("pinned " + pinned);

  const carousel = createInstance("AdwCarousel", {}, root, 0, {});
  const pages: HostNode[] = [];
  const pageNames = ["a", "b", "c", "d"];
  for (const name of pageNames) {
    pages.push(createInstance("GtkLabel", { label: name }, root, 0, {}));
  }
  const carouselWidget = widget(carousel);
  const paging = carouselWidget instanceof AdwCarousel ? carouselWidget : null;
  let carouselOrder = "not a carousel";
  if (paging !== null) {
    const order = (): string => {
      let all = "";
      for (let i = 0; i < paging.get_n_pages(); i++) {
        const page = paging.get_nth_page(i);
        for (let j = 0; j < pages.length; j++) {
          if (widget(pages[j]!) === page) {
            all += pageNames[j]!;
          }
        }
      }
      return all;
    };
    appendInitialChild(carousel, pages[0]!);
    appendInitialChild(carousel, pages[1]!);
    appendInitialChild(carousel, pages[2]!);
    carouselOrder = order();
    insertBefore(carousel, pages[3]!, pages[1]!);
    carouselOrder += ">" + order();
    insertBefore(carousel, pages[0]!, pages[2]!);
    carouselOrder += ">" + order();
    insertBefore(carousel, pages[2]!, pages[3]!);
    carouselOrder += ">" + order();
    appendInitialChild(carousel, pages[2]!);
    carouselOrder += ">" + order();
    removeChild(carousel, pages[1]!);
    carouselOrder += ">" + order();
  }
  react_gtk_log("carousel " + carouselOrder);

  let poppedHeard = 0;
  const navProps: Props = {
    onPopped: () => {
      poppedHeard++;
    },
  };
  const nav = createInstance("AdwNavigationView", navProps, root, 0, {});
  const navNames = ["A", "B", "C"];
  const navPages: HostNode[] = [];
  for (const name of navNames) {
    const page = createInstance("AdwNavigationPage", { title: name }, root, 0, {});
    appendInitialChild(page, createInstance("GtkLabel", { label: name }, root, 0, {}));
    navPages.push(page);
  }
  const navWidget = widget(nav);
  const navigating = navWidget instanceof AdwNavigationView ? navWidget : null;
  let navigation = "not a navigation view";
  if (navigating !== null) {
    const stack = (): string => {
      let names = "";
      for (let page = navigating.get_visible_page(); page !== null; page = navigating.get_previous_page(page)) {
        for (let i = 0; i < navPages.length; i++) {
          if (widget(navPages[i]!) === page) {
            names = navNames[i]! + names;
          }
        }
      }
      return names;
    };
    appendInitialChild(nav, navPages[0]!);
    appendInitialChild(nav, navPages[1]!);
    navigation = stack();
    appendInitialChild(nav, navPages[2]!);
    navigation += ">" + stack();
    removeChild(nav, navPages[2]!);
    navigation += ">" + stack();
    insertBefore(nav, navPages[2]!, navPages[0]!);
    navigation += ">" + stack();
    // The user goes back and the app keeps the page: it comes back.
    navigating.pop();
    navigation += " user>" + stack();
    idle();
    navigation += ">" + stack();
    // The user goes back and the app takes the page away: it stays gone.
    navigating.pop();
    removeChild(nav, navPages[1]!);
    idle();
    navigation += " app>" + stack() + " heard=" + String(poppedHeard);
  }
  react_gtk_log("navigation " + navigation);

  const toggles = createInstance("AdwToggleGroup", { activeName: "b" }, root, 0, {});
  const toggleA = createInstance("AdwToggleGroup.Toggle", { name: "a", label: "A" }, root, 0, {});
  const toggleBProps: Props = { name: "b", label: "B" };
  const toggleB = createInstance("AdwToggleGroup.Toggle", toggleBProps, root, 0, {});
  const toggleC = createInstance("AdwToggleGroup.Toggle", { name: "c", label: "C" }, root, 0, {});
  appendInitialChild(toggles, toggleA);
  appendInitialChild(toggles, toggleB);
  const togglesWidget = widget(toggles);
  const toggleGroup = togglesWidget instanceof AdwToggleGroup ? togglesWidget : null;
  let toggling = "not a toggle group";
  if (toggleGroup !== null) {
    const names = (): string => {
      let all = "";
      for (let i = 0; i < toggleGroup.get_n_toggles(); i++) {
        const toggle = toggleGroup.get_toggle(i);
        all += toggle === null ? "?" : String(toggle.get_name());
      }
      return all;
    };
    toggling = names() + " active=" + String(toggleGroup.get_active_name());
    insertBefore(toggles, toggleC, toggleB);
    toggling += " " + names();
    // The user picks another: the app keeps "b", so it goes back.
    toggleGroup.set_active_name("a");
    idle();
    toggling += " kept=" + String(toggleGroup.get_active_name());
    commitUpdate(toggleB, "AdwToggleGroup.Toggle", toggleBProps, { name: "b", label: "Bee" }, {});
    const b = toggleGroup.get_toggle_by_name("b");
    toggling += " " + (b === null ? "none" : String(b.get_label()));
    removeChild(toggles, toggleC);
    toggling += " " + names();
  }
  react_gtk_log("toggles " + toggling);

  // A dialog is presented within a shown libadwaita window, as an app's is
  // (over a plain GtkWindow, libadwaita opens it as a window of its own).
  const adwWindow = new AdwWindow();
  const shown = new WindowRoot(adwWindow, [adw]);
  const anchor = createInstance("GtkBox", {}, shown, 0, {});
  adwWindow.set_content(widget(anchor));
  adwWindow.set_default_size(640, 480);
  adwWindow.present();
  idle();
  // Every response heard: React's own close (`force_close`, which libadwaita
  // reports as the `close` response) is not one.
  let responded = "";
  const dialogProps: Props = {
    heading: "Sure?",
    onResponse: (response: string) => {
      responded += (responded === "" ? "" : ",") + response;
    },
  };
  const dialog = createInstance("AdwAlertDialog", dialogProps, shown, 0, {});
  const cancelResponse = createInstance("AdwAlertDialog.Response", { id: "cancel", label: "Cancel" }, shown, 0, {});
  const okResponse = createInstance("AdwAlertDialog.Response", { id: "ok", label: "OK" }, shown, 0, {});
  appendInitialChild(dialog, cancelResponse);
  appendInitialChild(dialog, okResponse);
  const dialogWantsMount = finalizeInitialChildren(dialog, "AdwAlertDialog", dialogProps, 0);
  appendInitialChild(anchor, dialog);
  const unplaced = widget(dialog).get_root() === null;
  commitMount(dialog, "AdwAlertDialog", dialogProps, {});
  idle();
  const within = widget(dialog).get_root() === shown.window;
  const responseOrder = (): string => {
    const labels: string[] = [];
    buttonLabels(widget(dialog), labels);
    return labels.join(",");
  };
  let responses = responseOrder();
  // A response React renders between two goes between them.
  const deleteProps: Props = { id: "delete", label: "Delete" };
  const deleteResponse = createInstance("AdwAlertDialog.Response", deleteProps, shown, 0, {});
  insertBefore(dialog, deleteResponse, okResponse);
  responses += ">" + responseOrder();
  commitUpdate(deleteResponse, "AdwAlertDialog.Response", deleteProps, { id: "delete", label: "Erase", enabled: false }, {});
  const alerting = widget(dialog);
  if (alerting instanceof AdwAlertDialog) {
    responses += ">" + alerting.get_response_label("delete") + " " + String(alerting.get_response_enabled("delete"));
  }
  removeChild(dialog, deleteResponse);
  responses += ">" + responseOrder();
  // The response a user's button gives, as the dialog emits it: a detailed
  // signal, heard whatever its detail.
  const alert = widget(dialog);
  if (alert instanceof AdwAlertDialog) {
    alert.emit("response", "cancel");
  }
  removeChild(anchor, dialog);
  idle();
  const closed = widget(dialog).get_root() === null;
  react_gtk_log("dialog " + String(dialogWantsMount) + " " + String(unplaced) + " " + String(within) + " " + String(closed) + " responded=" + responded + " " + responses);

  // A PreferencesDialog's children are its pages, added, not its content.
  const prefs = createInstance("AdwPreferencesDialog", {}, shown, 0, {});
  const pageOne = createInstance("AdwPreferencesPage", { name: "one", title: "One" }, shown, 0, {});
  const pageTwo = createInstance("AdwPreferencesPage", { name: "two", title: "Two" }, shown, 0, {});
  appendInitialChild(prefs, pageOne);
  appendInitialChild(prefs, pageTwo);
  const prefsWidget = widget(prefs);
  let preferring = "not a preferences dialog";
  if (prefsWidget instanceof AdwPreferencesDialog) {
    preferring = String(prefsWidget.get_visible_page_name());
    removeChild(prefs, pageTwo);
    preferring += " removed=" + String(widget(pageTwo).get_parent() === null) + " shown=" + String(prefsWidget.get_visible_page_name());
  }
  react_gtk_log("preferences " + preferring);

  // Toasts shown while rendered: React taking one out is not heard; the
  // user dismissing one is.
  let dismissedA = 0;
  let dismissedB = 0;
  const toasts = createInstance("AdwToastOverlay", {}, shown, 0, {});
  appendInitialChild(toasts, createInstance("GtkLabel", { label: "under" }, shown, 0, {}));
  const toastA = createInstance("AdwToastOverlay.Toast", { title: "A", timeout: 0, onDismissed: () => dismissedA++ }, shown, 0, {});
  const toastB = createInstance("AdwToastOverlay.Toast", { title: "B", timeout: 0, onDismissed: () => dismissedB++ }, shown, 0, {});
  appendInitialChild(toasts, toastA);
  appendInitialChild(toasts, toastB);
  appendInitialChild(anchor, toasts);
  idle();
  removeChild(toasts, toastB);
  const toastsWidget = widget(toasts);
  if (toastsWidget instanceof AdwToastOverlay) {
    toastsWidget.dismiss_all();
  }
  idle();
  removeChild(anchor, toasts);
  react_gtk_log("toasts " + String(dismissedA) + " " + String(dismissedB));

  // Every apply and unapply heard, in order.
  let breaks = "";
  const breakpointProps = (name: string, condition: string): Props => ({
    condition,
    onApply: () => {
      breaks += " " + name + "+";
    },
    onUnapply: () => {
      breaks += " " + name + "-";
    },
  });
  const bin = createInstance("AdwBreakpointBin", { widthRequest: 100, heightRequest: 100 }, shown, 0, {});
  const always = createInstance("AdwBreakpointBin.Breakpoint", breakpointProps("A", "min-width: 1px"), shown, 0, {});
  const later = createInstance("AdwBreakpointBin.Breakpoint", breakpointProps("B", "min-width: 100000px"), shown, 0, {});
  // A bin applies breakpoints to what it holds: with no child it applies none.
  appendInitialChild(bin, createInstance("GtkLabel", { label: "adapts" }, shown, 0, {}));
  appendInitialChild(bin, always);
  appendInitialChild(bin, later);
  appendInitialChild(anchor, bin);
  settle(200);
  breaks += " |";
  commitUpdate(later, "AdwBreakpointBin.Breakpoint", breakpointProps("B", "min-width: 100000px"), breakpointProps("B", "min-width: 2px"), {});
  settle(200);
  breaks += " |";
  removeChild(bin, later);
  settle(200);
  removeChild(anchor, bin);
  react_gtk_log("breakpoints" + breaks);

  // A window cannot remove a breakpoint: taken out, it is disarmed, and
  // placed again, armed again.
  let windowBreaks = "";
  const windowPoint = (): Props => ({
    condition: "min-width: 1px",
    onApply: () => {
      windowBreaks += " W+";
    },
    onUnapply: () => {
      windowBreaks += " W-";
    },
  });
  const opened = createInstance("AdwWindow", { defaultWidth: 320, defaultHeight: 240 }, shown, 0, {});
  const openedContent = createInstance("AdwWindow.Content", {}, shown, 0, {});
  appendInitialChild(openedContent, createInstance("GtkLabel", { label: "window" }, shown, 0, {}));
  appendInitialChild(opened, openedContent);
  const point = createInstance("AdwWindow.Breakpoint", windowPoint(), shown, 0, {});
  appendInitialChild(opened, point);
  appendInitialChild(anchor, opened);
  commitMount(opened, "AdwWindow", {}, {});
  settle(200);
  const openedWindow = widget(opened);
  const hasBreakpoint = (): string =>
    openedWindow instanceof AdwWindow ? String(openedWindow.get_current_breakpoint() !== null) : "not a window";
  windowBreaks += " " + hasBreakpoint();
  removeChild(opened, point);
  settle(200);
  windowBreaks += " " + hasBreakpoint();
  appendInitialChild(opened, point);
  settle(200);
  windowBreaks += " " + hasBreakpoint();
  removeChild(anchor, opened);
  react_gtk_log("window-breakpoint" + windowBreaks);

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
