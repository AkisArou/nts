// libadwaita's containers that place children in groups, as GTK's bars do
// (../children.ts): a group element holds any number of widgets, placed where
// its name says.
//
//   <HeaderBar><HeaderBar.Start><Button /></HeaderBar.Start></HeaderBar>
//   <ToolbarView><ToolbarView.Top><HeaderBar /></ToolbarView.Top>...</ToolbarView>
//   <ActionRow title="Wi-Fi"><ActionRow.Suffix><Switch /></ActionRow.Suffix></ActionRow>
//   <ViewStack><ViewStack.Page name="inbox" title="Inbox" iconName="mail-symbolic">...</ViewStack.Page></ViewStack>
//   <TabView><TabView.Page title="Notes" onClose={() => close(id)}>...</TabView.Page></TabView>
//   <ApplicationWindow><ApplicationWindow.Breakpoint condition="max-width: 500sp" onApply={...} /></ApplicationWindow>
//   <NavigationView onPopped={back}>{path.map((id) => <NavigationPage key={id} title={id}>...</NavigationPage>)}</NavigationView>
//
// Each is a GroupNode with a placement of libadwaita's, so GTK's module never
// names an Adw class. A row's subclasses (a SwitchRow is an ActionRow) take
// their ancestor's groups.

import {
  AdwActionRow,
  AdwApplicationWindow,
  AdwBreakpoint,
  AdwBreakpointBin,
  AdwBreakpointCondition,
  AdwDialog,
  AdwEntryRow,
  AdwExpanderRow,
  AdwHeaderBar,
  AdwNavigationPage,
  AdwNavigationView,
  AdwTabView,
  AdwToolbarView,
  AdwViewStack,
  AdwWindow,
  type AdwTabPage,
  type AdwViewStackPage,
} from "c:Adw-1";
import { g_signal_handler_disconnect } from "c:GObject-2.0";
import type { GtkWidget } from "c:Gtk-4.0";
import type { HostComponent } from "shared/ReactHostComponent.ts";

import { GroupNode, GroupPlacement, type PackProps } from "../children.ts";
import {
  HostNode,
  insertAt,
  isReactWriting,
  PlacedNode,
  type Props,
  scheduleRestore,
  SignalSlot,
  type WidgetNode,
  writeAsReact,
} from "../HostNode.ts";

export interface HeaderBarChildren {
  /** `<HeaderBar.Start>`: its children, packed at the bar's start, left to right. */
  readonly Start: HostComponent<"AdwHeaderBar.Start", PackProps>;
  /** `<HeaderBar.End>`: its children, packed at the bar's end, left to right. */
  readonly End: HostComponent<"AdwHeaderBar.End", PackProps>;
}

export interface ToolbarViewChildren {
  /** `<ToolbarView.Top>`: its children, as bars above the content, top to bottom. */
  readonly Top: HostComponent<"AdwToolbarView.Top", PackProps>;
  /** `<ToolbarView.Bottom>`: its children, as bars below the content, top to bottom. */
  readonly Bottom: HostComponent<"AdwToolbarView.Bottom", PackProps>;
}

export interface ActionRowChildren {
  /** `<ActionRow.Prefix>`: its children, before the row's title, left to right. */
  readonly Prefix: HostComponent<"AdwActionRow.Prefix", PackProps>;
  /** `<ActionRow.Suffix>`: its children, after the row's title, left to right. */
  readonly Suffix: HostComponent<"AdwActionRow.Suffix", PackProps>;
}

export interface EntryRowChildren {
  /** `<EntryRow.Prefix>`: its children, before the row's entry, left to right. */
  readonly Prefix: HostComponent<"AdwEntryRow.Prefix", PackProps>;
  /** `<EntryRow.Suffix>`: its children, after the row's entry, left to right. */
  readonly Suffix: HostComponent<"AdwEntryRow.Suffix", PackProps>;
}

export interface ExpanderRowChildren {
  /** `<ExpanderRow.Prefix>`: its children, before the row's title, left to right. */
  readonly Prefix: HostComponent<"AdwExpanderRow.Prefix", PackProps>;
  /** `<ExpanderRow.Suffix>`: its children, after the row's title, left to right. */
  readonly Suffix: HostComponent<"AdwExpanderRow.Suffix", PackProps>;
}

/** Where a group element of libadwaita's places its widgets, by its host type. */
function placementOf(type: string): GroupPlacement {
  switch (type) {
    case "AdwHeaderBar.Start":
    case "AdwHeaderBar.End": {
      const end = type === "AdwHeaderBar.End";
      return new GroupPlacement(
        (bar, widget) => {
          if (!(bar instanceof AdwHeaderBar)) return false;
          if (end) bar.pack_end(widget);
          else bar.pack_start(widget);
          return true;
        },
        (bar, widget) => {
          if (bar instanceof AdwHeaderBar) bar.remove(widget);
        },
        end,
      );
    }
    case "AdwToolbarView.Top":
    case "AdwToolbarView.Bottom": {
      const top = type === "AdwToolbarView.Top";
      return new GroupPlacement(
        (view, widget) => {
          if (!(view instanceof AdwToolbarView)) return false;
          if (top) view.add_top_bar(widget);
          else view.add_bottom_bar(widget);
          return true;
        },
        (view, widget) => {
          if (view instanceof AdwToolbarView) view.remove(widget);
        },
        false,
      );
    }
    case "AdwActionRow.Prefix":
    case "AdwActionRow.Suffix": {
      const prefix = type === "AdwActionRow.Prefix";
      return new GroupPlacement(
        (row, widget) => {
          if (!(row instanceof AdwActionRow)) return false;
          if (prefix) row.add_prefix(widget);
          else row.add_suffix(widget);
          return true;
        },
        (row, widget) => {
          if (row instanceof AdwActionRow) row.remove(widget);
        },
        // A row adds a prefix before the ones it has: its prefixes fill from
        // the end (checked on the widget, native/adw's `row` line).
        prefix,
      );
    }
    case "AdwEntryRow.Prefix":
    case "AdwEntryRow.Suffix": {
      const prefix = type === "AdwEntryRow.Prefix";
      return new GroupPlacement(
        (row, widget) => {
          if (!(row instanceof AdwEntryRow)) return false;
          if (prefix) row.add_prefix(widget);
          else row.add_suffix(widget);
          return true;
        },
        (row, widget) => {
          if (row instanceof AdwEntryRow) row.remove(widget);
        },
        // As an ActionRow, an EntryRow prepends its prefixes (measured:
        // native/adw's `row` line).
        prefix,
      );
    }
    case "AdwExpanderRow.Prefix":
    case "AdwExpanderRow.Suffix": {
      const prefix = type === "AdwExpanderRow.Prefix";
      return new GroupPlacement(
        (row, widget) => {
          if (!(row instanceof AdwExpanderRow)) return false;
          if (prefix) row.add_prefix(widget);
          else row.add_suffix(widget);
          return true;
        },
        (row, widget) => {
          if (row instanceof AdwExpanderRow) row.remove(widget);
        },
        // Unlike an ActionRow, an ExpanderRow appends its prefixes.
        false,
      );
    }
  }
  throw new Error(`react-gtk/adw has no group <${type}>.`);
}

/** A group element of libadwaita's: its placement comes from its host type. */
export class AdwGroupNode extends GroupNode {
  constructor(type: string) {
    super(type, placementOf(type));
  }
}

// ---- ViewStack -------------------------------------------------------------------------

export interface ViewStackPageProps {
  /** The page's name: what the ViewStack's `visibleChildName` selects. */
  name?: string;
  /** The page's title, as a ViewSwitcher shows it. */
  title?: string;
  iconName?: string;
  needsAttention?: boolean;
  /** A count a ViewSwitcher shows on the page's button: 0 for none. */
  badgeNumber?: number;
  children?: unknown;
}

export interface ViewStackChildren {
  /** `<ViewStack.Page name title iconName>`: its one child, a page of the ViewStack. */
  readonly Page: HostComponent<"AdwViewStack.Page", ViewStackPageProps>;
}

/**
 * A page of a ViewStack, as GTK's Stack.Page is of a Stack (../children.ts):
 * added with its name, title and icon, described again in place when they
 * change, and selecting itself when the ViewStack's `visibleChildName`,
 * applied before its pages existed, names it.
 */
export class ViewStackPageNode extends PlacedNode {
  protected attach(owner: WidgetNode, widget: GtkWidget): void {
    const stack = owner.widget;
    if (!(stack instanceof AdwViewStack)) {
      throw new Error(`<ViewStack.Page> goes directly inside a <ViewStack>, not a <${owner.name()}>.`);
    }
    this.describe(stack.add(widget));
    const name = this.props["name"];
    if (typeof name === "string" && owner.prop("visibleChildName") === name) {
      stack.set_visible_child(widget);
    }
  }
  protected detach(owner: WidgetNode, widget: GtkWidget): void {
    const stack = owner.widget;
    if (stack instanceof AdwViewStack) {
      stack.remove(widget);
    }
  }
  protected update(owner: WidgetNode, widget: GtkWidget): void {
    const stack = owner.widget;
    if (stack instanceof AdwViewStack) {
      this.describe(stack.get_page(widget));
    }
  }

  private describe(page: AdwViewStackPage): void {
    const props = this.props;
    const text = (key: string): string | null => {
      const value = props[key];
      return typeof value === "string" ? value : null;
    };
    page.set_name(text("name"));
    page.set_title(text("title"));
    page.set_icon_name(text("iconName"));
    page.set_needs_attention(props["needsAttention"] === true);
    const badge = props["badgeNumber"];
    page.set_badge_number(typeof badge === "number" ? badge : 0);
  }
}

// ---- TabView ---------------------------------------------------------------------------

export interface TabViewPageProps {
  /** The tab's title. */
  title?: string;
  tooltip?: string;
  /** Whether the tab shows that its page is loading. */
  loading?: boolean;
  /**
   * Whether the tab is pinned: shown as an icon, before every unpinned tab
   * whatever React's order, and not closed by the user.
   */
  pinned?: boolean;
  needsAttention?: boolean;
  /** A word a TabOverview's search finds the tab by, besides its title. */
  keyword?: string;
  /**
   * Whether this is the selected tab. Controlled, as a Stack's
   * `visibleChildName` is: the user selecting another tab reports it as that
   * tab's `onSelect`, and this one is selected again unless the app moves
   * `selected` to that tab.
   */
  selected?: boolean;
  /** The user selected the tab. */
  onSelect?: () => void;
  /**
   * The user asked to close the tab (its close button, a shortcut). The tab
   * stays until the app stops rendering it.
   */
  onClose?: () => void;
  children?: unknown;
}

export interface TabViewChildren {
  /** `<TabView.Page title onClose>`: its one child, a tab of the TabView. */
  readonly Page: HostComponent<"AdwTabView.Page", TabViewPageProps>;
}

// What a tab's handlers read. The TabView holds the handlers, so they hold
// this and not the node, which holds the TabView.
class TabState {
  readonly onClose: SignalSlot = new SignalSlot();
  readonly onSelect: SignalSlot = new SignalSlot();
  // The props' `selected`.
  selected = false;
  // True while React closes the tab: the close is its own, and goes ahead.
  closingByReact = false;
}

// Selecting a tab from props, or closing the selected one (libadwaita then
// selects another), is React's write: no tab's `onSelect` hears it.
function selectByReact(view: AdwTabView, page: AdwTabPage): void {
  if (view.get_selected_page() !== page) {
    writeAsReact(() => view.set_selected_page(page));
  }
}

/**
 * A tab of a TabView, placed where React places it: inserted before the tab
 * after it, and moved with `reorder_page`, so it stays selected. Which tabs
 * exist is React's: a close the user asks for is refused and reported as
 * `onClose`, and React closes a tab by taking its element out. Which tab is
 * selected is the app's where a tab says `selected`.
 */
export class TabViewPageNode extends PlacedNode {
  private readonly state: TabState = new TabState();
  private closeHandler = 0;
  private selectHandler = 0;

  protected attach(owner: WidgetNode, widget: GtkWidget): void {
    const view = owner.widget;
    if (!(view instanceof AdwTabView)) {
      throw new Error(`<TabView.Page> goes directly inside a <TabView>, not a <${owner.name()}>.`);
    }
    const page = this.pinned() ? view.insert_pinned(widget, this.target(owner, view, true)) : view.insert(widget, this.target(owner, view, false));
    this.describe(view, page);
    const state = this.state;
    this.closeHandler = view.connect("close-page", (self, asked) => {
      if (asked !== page) {
        return false;
      }
      self.close_page_finish(page, state.closingByReact);
      if (!state.closingByReact) {
        state.onClose.fire();
      }
      return true;
    });
    // `self`, not `view`: a handler holding the TabView would keep it alive.
    this.selectHandler = view.connect("notify::selected-page", (self) => {
      const notified = self instanceof AdwTabView ? self : null;
      if (notified === null || isReactWriting()) {
        return;
      }
      if (notified.get_selected_page() === page) {
        state.onSelect.fire();
      } else if (state.selected) {
        scheduleRestore(() => {
          if (state.selected) {
            selectByReact(notified, page);
          }
        });
      }
    });
  }
  protected detach(owner: WidgetNode, widget: GtkWidget): void {
    const view = owner.widget instanceof AdwTabView ? owner.widget : null;
    if (view === null) {
      return;
    }
    g_signal_handler_disconnect(view, this.selectHandler);
    this.state.closingByReact = true;
    writeAsReact(() => view.close_page(view.get_page(widget)));
    this.state.closingByReact = false;
    g_signal_handler_disconnect(view, this.closeHandler);
  }
  detachDeleted(): void {
    this.state.onClose.handler = null;
    this.state.onSelect.handler = null;
  }
  protected move(owner: WidgetNode, widget: GtkWidget): boolean {
    const view = owner.widget;
    if (!(view instanceof AdwTabView)) {
      return false;
    }
    const page = view.get_page(widget);
    const from = view.get_page_position(page);
    // Counted with this tab taken out: a tab after it moves up one.
    const to = this.target(owner, view, page.get_pinned());
    view.reorder_page(page, to > from ? to - 1 : to);
    return true;
  }
  protected update(owner: WidgetNode, widget: GtkWidget): void {
    const view = owner.widget;
    if (!(view instanceof AdwTabView)) {
      return;
    }
    const page = view.get_page(widget);
    // Pinned or unpinned, libadwaita puts the tab at the edge of its new
    // region; it then goes where React's order puts it there.
    const pinned = this.pinned();
    if (page.get_pinned() !== pinned) {
      view.set_page_pinned(page, pinned);
      this.move(owner, widget);
    }
    this.describe(view, page);
  }

  private pinned(): boolean {
    return this.props["pinned"] === true;
  }

  // The index of the tab React's order puts after this one (past the end of
  // the region, with none), kept to the tab's region: libadwaita keeps pinned
  // tabs before the others.
  private target(owner: WidgetNode, view: AdwTabView, pinned: boolean): number {
    const pinnedCount = view.get_n_pinned_pages();
    const next = owner.elementAfter(this);
    const at = next === null ? (pinned ? pinnedCount : view.get_n_pages()) : view.get_page_position(view.get_page(next));
    return pinned ? Math.min(at, pinnedCount) : Math.max(at, pinnedCount);
  }

  private describe(view: AdwTabView, page: AdwTabPage): void {
    const props = this.props;
    const text = (key: string): string => {
      const value = props[key];
      return typeof value === "string" ? value : "";
    };
    page.set_title(text("title"));
    page.set_tooltip(text("tooltip"));
    page.set_keyword(text("keyword"));
    page.set_loading(props["loading"] === true);
    page.set_needs_attention(props["needsAttention"] === true);
    const state = this.state;
    const onClose = props["onClose"];
    if (typeof onClose === "function") {
      state.onClose.handler = onClose;
    } else {
      state.onClose.handler = null;
    }
    const onSelect = props["onSelect"];
    if (typeof onSelect === "function") {
      state.onSelect.handler = onSelect;
    } else {
      state.onSelect.handler = null;
    }
    state.selected = props["selected"] === true;
    if (state.selected) {
      selectByReact(view, page);
    }
  }
}

// ---- breakpoints ---------------------------------------------------------------------

export interface BreakpointProps {
  /**
   * When the breakpoint applies, in libadwaita's syntax: `"max-width: 500sp"`,
   * `"max-aspect-ratio: 4/3 or max-width: 800px"`. Of a container's
   * breakpoints, the last whose condition holds is the one that applies.
   */
  condition?: string;
  /** The breakpoint began to apply. */
  onApply?: () => void;
  /** It stopped applying: its condition no longer holds, or a later one's does. */
  onUnapply?: () => void;
}

export interface WindowBreakpoints {
  /** `<Window.Breakpoint condition onApply onUnapply>`: a breakpoint of the window. */
  readonly Breakpoint: HostComponent<"AdwWindow.Breakpoint", BreakpointProps>;
}

export interface ApplicationWindowBreakpoints {
  /** `<ApplicationWindow.Breakpoint condition onApply onUnapply>`: a breakpoint of the window. */
  readonly Breakpoint: HostComponent<"AdwApplicationWindow.Breakpoint", BreakpointProps>;
}

export interface BreakpointBinBreakpoints {
  /** `<BreakpointBin.Breakpoint condition onApply onUnapply>`: a breakpoint of the bin. */
  readonly Breakpoint: HostComponent<"AdwBreakpointBin.Breakpoint", BreakpointProps>;
}

export interface DialogBreakpoints {
  /** `<Dialog.Breakpoint condition onApply onUnapply>`: a breakpoint of the dialog. */
  readonly Breakpoint: HostComponent<"AdwDialog.Breakpoint", BreakpointProps>;
}

// What the breakpoint's handlers read. The breakpoint holds the handlers, so
// they hold this and not the node, which holds the breakpoint.
class BreakpointState {
  readonly onApply: SignalSlot = new SignalSlot();
  readonly onUnapply: SignalSlot = new SignalSlot();
  // Whether the element is placed: a breakpoint React took out reports nothing.
  placed = false;
}

/**
 * A breakpoint of a window, a dialog or a BreakpointBin: the app hears it
 * apply and unapply, and renders for it. libadwaita's setters, which change
 * properties when a breakpoint applies, are what state is for in React.
 *
 * A BreakpointBin removes a breakpoint React takes out. A window or a dialog
 * cannot remove one, so it is disarmed: its condition is cleared, which never
 * holds, and placed again it is armed again.
 */
export class BreakpointNode extends HostNode {
  private readonly breakpoint: AdwBreakpoint = new AdwBreakpoint();
  private readonly state: BreakpointState = new BreakpointState();
  private condition: string | null = null;
  private owner: WidgetNode | null = null;
  // The widget the breakpoint was added to, for good unless it is a bin.
  private addedTo: GtkWidget | null = null;

  constructor(type: string) {
    super(type);
    const state = this.state;
    this.breakpoint.connect("apply", () => {
      if (state.placed) {
        state.onApply.fire();
      }
    });
    this.breakpoint.connect("unapply", () => {
      if (state.placed) {
        state.onUnapply.fire();
      }
    });
  }

  applyProps(_previous: Props | null, next: Props): void {
    if (next["children"] !== undefined) {
      throw new Error(`<${this.name()}> holds no children.`);
    }
    const onApply = next["onApply"];
    if (typeof onApply === "function") {
      this.state.onApply.handler = onApply;
    } else {
      this.state.onApply.handler = null;
    }
    const onUnapply = next["onUnapply"];
    if (typeof onUnapply === "function") {
      this.state.onUnapply.handler = onUnapply;
    } else {
      this.state.onUnapply.handler = null;
    }
    const condition = next["condition"];
    this.condition = typeof condition === "string" ? condition : null;
    if (this.owner !== null) {
      this.arm();
    }
  }

  appendChild(child: HostNode): void {
    throw new Error(`<${this.name()}> holds no children, not a <${child.name()}>.`);
  }
  insertBefore(child: HostNode, _before: HostNode): void {
    this.appendChild(child);
  }
  removeChild(_child: HostNode): void {}

  placeIn(parent: WidgetNode, _before: HostNode | null): void {
    const container = parent.widget;
    if (this.addedTo !== container) {
      if (this.addedTo !== null) {
        throw new Error(`<${this.name()}> cannot move to another widget: libadwaita keeps a breakpoint where it was added.`);
      }
      this.addTo(parent);
      this.addedTo = container;
    }
    this.owner = parent;
    this.state.placed = true;
    this.arm();
  }
  takeOutOf(parent: WidgetNode): void {
    if (this.owner !== parent) {
      return;
    }
    this.owner = null;
    this.state.placed = false;
    const bin = parent.widget instanceof AdwBreakpointBin ? parent.widget : null;
    if (bin !== null) {
      bin.remove_breakpoint(this.breakpoint);
      this.addedTo = null;
    } else {
      writeAsReact(() => this.breakpoint.set_condition(null));
    }
  }

  private addTo(parent: WidgetNode): void {
    const container = parent.widget;
    if (container instanceof AdwBreakpointBin) {
      container.add_breakpoint(this.breakpoint);
    } else if (container instanceof AdwWindow) {
      container.add_breakpoint(this.breakpoint);
    } else if (container instanceof AdwApplicationWindow) {
      container.add_breakpoint(this.breakpoint);
    } else if (container instanceof AdwDialog) {
      container.add_breakpoint(this.breakpoint);
    } else {
      const owner = this.name().split(".")[0];
      throw new Error(`<${this.name()}> goes directly inside a <${owner}>, not a <${parent.name()}>.`);
    }
  }

  // Sets the condition the props give; none never holds.
  private arm(): void {
    const condition = this.condition;
    this.breakpoint.set_condition(condition === null ? null : AdwBreakpointCondition.parse(condition));
  }

  detachDeleted(): void {
    this.state.onApply.handler = null;
    this.state.onUnapply.handler = null;
  }
  widgetNode(): WidgetNode | null {
    return null;
  }
  shownWidget(): GtkWidget | null {
    return null;
  }
  publicInstance(): GtkWidget {
    throw new Error(`<${this.name()}> is a breakpoint, not a widget: put the ref on a widget.`);
  }
  // A breakpoint shows nothing, so Suspense has nothing of it to hide.
  setVisible(_visible: boolean): void {}
}

// ---- NavigationView ------------------------------------------------------------------

/**
 * A NavigationView's children as its navigation stack, bottom first: the
 * last is the page shown, and rendering one more pushes it.
 *
 *   <NavigationView onPopped={() => setPath(path.slice(0, -1))}>
 *     {path.map((id) => <NavigationPage key={id} title={id}>...</NavigationPage>)}
 *   </NavigationView>
 *
 * After each change the view is brought to React's stack the way a user
 * would see it move: pages added on top are pushed, pages taken off the top
 * are popped (`pop_to_page`), both animated; any other change replaces the
 * stack at once. The stack is controlled, as a Stack's `visibleChildName`
 * is: the user going back is heard as the view's `onPopped`, and the page
 * comes back after the flush unless the app stops rendering it. React's own
 * pushes and pops are not heard.
 */
export class NavigationStack {
  // React's order of the pages; the handlers read it, so it is its own object.
  private readonly pages: WidgetNode[] = [];
  private connected = false;

  place(owner: WidgetNode, child: WidgetNode, before: WidgetNode | null, moving: boolean): void {
    const view = owner.widget instanceof AdwNavigationView ? owner.widget : null;
    if (view === null) {
      return;
    }
    if (!(child.widget instanceof AdwNavigationPage)) {
      throw new Error(`<NavigationView> holds <NavigationPage>s, not a <${child.name()}>.`);
    }
    const pages = this.pages;
    if (moving) {
      const from = pages.indexOf(child);
      if (from >= 0) {
        pages.splice(from, 1);
      }
    }
    const at = before === null ? -1 : pages.indexOf(before);
    insertAt(pages, at < 0 ? pages.length : at, child);
    this.connect(view);
    syncStack(view, pages);
  }

  unplace(owner: WidgetNode, child: WidgetNode): void {
    const view = owner.widget instanceof AdwNavigationView ? owner.widget : null;
    const at = this.pages.indexOf(child);
    if (view === null || at < 0) {
      return;
    }
    this.pages.splice(at, 1);
    syncStack(view, this.pages);
  }

  // The user moved the stack (back, or a `navigation.push` action): React's
  // stack comes back after the flush, in which the app can take it up.
  private connect(view: AdwNavigationView): void {
    if (this.connected) {
      return;
    }
    this.connected = true;
    const pages = this.pages;
    view.connect("popped", (self, _page) => {
      if (!isReactWriting()) {
        scheduleRestore(() => syncStack(self, pages));
      }
    });
    view.connect("pushed", (self) => {
      if (!isReactWriting()) {
        scheduleRestore(() => syncStack(self, pages));
      }
    });
  }
}

/** Brings `view`'s navigation stack to `pages`, bottom first. */
function syncStack(view: AdwNavigationView, pages: readonly WidgetNode[]): void {
  const wanted: AdwNavigationPage[] = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!.widget;
    if (page instanceof AdwNavigationPage) {
      wanted.push(page);
    }
  }
  const shown: AdwNavigationPage[] = [];
  for (let page = view.get_visible_page(); page !== null; page = view.get_previous_page(page)) {
    shown.push(page);
  }
  shown.reverse();
  let common = 0;
  while (common < wanted.length && common < shown.length && wanted[common] === shown[common]) {
    common++;
  }
  if (common === wanted.length && common === shown.length) {
    return;
  }
  writeAsReact(() => {
    if (common === shown.length && common > 0) {
      for (let i = common; i < wanted.length; i++) {
        view.push(wanted[i]!);
      }
    } else if (common === wanted.length && common > 0) {
      view.pop_to_page(wanted[common - 1]!);
    } else {
      view.replace(wanted);
    }
  });
}
