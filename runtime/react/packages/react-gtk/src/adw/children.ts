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
  AdwAlertDialog,
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
  AdwSidebar,
  AdwSidebarItem,
  AdwSidebarSection,
  AdwTabView,
  AdwToast,
  AdwToastOverlay,
  AdwToggle,
  AdwToggleGroup,
  AdwToolbarView,
  AdwViewStack,
  AdwWindow,
  type AdwResponseAppearance,
  type AdwToastPriority,
  type AdwTabPage,
  type AdwViewStackPage,
} from "c:Adw-1";
import { g_signal_handler_disconnect } from "c:GObject-2.0";
import type { AsNumber, c_int, c_ulong } from "@nts/scalars";
import type { GtkWidget } from "c:Gtk-4.0";
import type { HostComponent } from "shared/ReactHostComponent.ts";

import { AppendedPageNode, GroupNode, GroupPlacement, type PackProps } from "../children.ts";
import { cInt, cUint } from "../numbers.ts";
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
 * change, selecting itself when the ViewStack's `visibleChildName`, applied
 * before its pages existed, names it, and taking React's order when React
 * moves it although the ViewStack only appends (AppendedPageNode).
 */
export class ViewStackPageNode extends AppendedPageNode {
  protected appendsTo(parent: WidgetNode): boolean {
    return parent.widget instanceof AdwViewStack;
  }
  protected shownIn(parent: WidgetNode): GtkWidget | null {
    return parent.widget instanceof AdwViewStack ? parent.widget.get_visible_child() : null;
  }
  protected show(parent: WidgetNode, widget: GtkWidget): void {
    const stack = parent.widget;
    if (stack instanceof AdwViewStack && widget.get_parent() === stack) {
      stack.set_visible_child(widget);
    }
  }

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
    page.set_badge_number(cUint(typeof badge === "number" ? badge : 0, "badge"));
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
  // Handler ids as GObject made them, a `gulong` each, for disconnecting.
  private closeHandler: AsNumber<c_ulong> = 0;
  private selectHandler: AsNumber<c_ulong> = 0;

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
    view.reorder_page(page, cInt(to > from ? to - 1 : to, "position"));
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
  private target(owner: WidgetNode, view: AdwTabView, pinned: boolean): c_int {
    const pinnedCount = view.get_n_pinned_pages();
    const next = owner.elementAfter(this);
    const at = next === null ? (pinned ? pinnedCount : view.get_n_pages()) : view.get_page_position(view.get_page(next));
    return cInt(pinned ? Math.min(at, pinnedCount) : Math.max(at, pinnedCount), "position");
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

// ---- elements that stand for objects -------------------------------------------------

/**
 * An element that stands for an object of its container, not a widget: a
 * breakpoint, an AlertDialog's response, a ToggleGroup's toggle. It holds no
 * children, and shows nothing a ref or Suspense could reach.
 */
abstract class ObjectElementNode extends HostNode {
  appendChild(child: HostNode): void {
    throw new Error(`<${this.name()}> holds no children, not a <${child.name()}>.`);
  }
  insertBefore(child: HostNode, _before: HostNode): void {
    this.appendChild(child);
  }
  removeChild(_child: HostNode): void {}

  widgetNode(): WidgetNode | null {
    return null;
  }
  shownWidget(): GtkWidget | null {
    return null;
  }
  publicInstance(): GtkWidget {
    throw new Error(`<${this.name()}> is not a widget: put the ref on the widget it belongs to.`);
  }
  setVisible(_visible: boolean): void {}

  // Its container only appends: placed before another of its kind, it went
  // last, and those after it are placed again after it. Placing one again
  // passes no `before`, so this does not recur.
  protected appendFollowers(parent: WidgetNode): void {
    const after = parent.childrenAfter(this);
    for (let i = 0; i < after.length; i++) {
      const follower = after[i]!;
      if (follower.type === this.type) {
        follower.placeIn(parent, null);
      }
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
export class BreakpointNode extends ObjectElementNode {
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

// ---- AlertDialog responses -----------------------------------------------------------

export interface AlertResponseProps {
  /** What the dialog's `onResponse` hears when the user picks it. */
  id: string;
  /** The button's text: the id, if none. */
  label?: string;
  /** Suggested or destructive, or neither. */
  appearance?: AdwResponseAppearance;
  /** Whether the user can pick it: true, if not given. */
  enabled?: boolean;
}

export interface AlertDialogChildren {
  /** `<AlertDialog.Response id label appearance enabled>`: a button of the dialog, in React's order. */
  readonly Response: HostComponent<"AdwAlertDialog.Response", AlertResponseProps>;
}

/**
 * A response of an AlertDialog: one of its buttons, heard as the dialog's
 * `onResponse` with its id. The dialog only appends a response, so one React
 * places before others is added, and those after it in React's order are
 * added again after it.
 */
export class AlertResponseNode extends ObjectElementNode {
  private owner: WidgetNode | null = null;
  // The id it was added under, to remove it by.
  private added: string | null = null;
  private props: Props = {};

  applyProps(_previous: Props | null, next: Props): void {
    if (next["children"] !== undefined) {
      throw new Error(`<${this.name()}> holds no children: its text is its \`label\`.`);
    }
    this.props = next;
    const owner = this.owner;
    const dialog = owner === null ? null : owner.widget instanceof AdwAlertDialog ? owner.widget : null;
    if (owner === null || dialog === null) {
      return;
    }
    if (this.id() !== this.added) {
      // A new id is a new response, where this one was.
      this.add(dialog);
      this.appendFollowers(owner);
    } else {
      this.describe(dialog);
    }
  }

  placeIn(parent: WidgetNode, before: HostNode | null): void {
    const dialog = parent.widget instanceof AdwAlertDialog ? parent.widget : null;
    if (dialog === null) {
      throw new Error(`<${this.name()}> goes directly inside an <AlertDialog>, not a <${parent.name()}>.`);
    }
    this.owner = parent;
    this.add(dialog);
    if (before !== null) {
      this.appendFollowers(parent);
    }
  }
  takeOutOf(parent: WidgetNode): void {
    if (this.owner !== parent) {
      return;
    }
    const dialog = parent.widget instanceof AdwAlertDialog ? parent.widget : null;
    const added = this.added;
    if (dialog !== null && added !== null) {
      dialog.remove_response(added);
    }
    this.owner = null;
    this.added = null;
  }

  private id(): string {
    const id = this.props["id"];
    return typeof id === "string" ? id : "";
  }

  // Adds the response last, taking out what it was added as before.
  private add(dialog: AdwAlertDialog): void {
    const added = this.added;
    if (added !== null) {
      dialog.remove_response(added);
    }
    const id = this.id();
    const label = this.props["label"];
    dialog.add_response(id, typeof label === "string" ? label : id);
    this.added = id;
    this.describe(dialog);
  }

  private describe(dialog: AdwAlertDialog): void {
    const id = this.id();
    const label = this.props["label"];
    dialog.set_response_label(id, typeof label === "string" ? label : id);
    const appearance = this.props["appearance"];
    dialog.set_response_appearance(id, cUint(typeof appearance === "number" ? appearance : 0, "appearance"));
    dialog.set_response_enabled(id, this.props["enabled"] !== false);
  }

}

// ---- ToggleGroup ---------------------------------------------------------------------

export interface ToggleProps {
  /** What the group's `activeName` selects it by. */
  name?: string;
  label?: string;
  iconName?: string;
  tooltip?: string;
  /** Whether the user can pick it: true, if not given. */
  enabled?: boolean;
}

export interface ToggleGroupChildren {
  /** `<ToggleGroup.Toggle name label iconName>`: a toggle of the group, in React's order. */
  readonly Toggle: HostComponent<"AdwToggleGroup.Toggle", ToggleProps>;
}

/**
 * A toggle of a ToggleGroup, the group's segments: the user picking one is
 * the group's `activeName` changing, which is controlled. The group only
 * appends a toggle, so one React places before others is added, and those
 * after it in React's order are added again after it. The group's
 * `activeName`, applied before its toggles existed, selects the toggle it
 * names when that toggle is added.
 */
export class ToggleNode extends ObjectElementNode {
  private readonly toggle: AdwToggle = new AdwToggle();
  private owner: WidgetNode | null = null;
  private props: Props = {};

  // Only what changed is set: a toggle given its own name again is, to its
  // group, a second toggle of that name.
  applyProps(previous: Props | null, next: Props): void {
    if (next["children"] !== undefined) {
      throw new Error(`<${this.name()}> holds no children: its text is its \`label\`.`);
    }
    this.props = next;
    const changed = (key: string): boolean => previous === null || previous[key] !== next[key];
    const text = (key: string): string | null => {
      const value = next[key];
      return typeof value === "string" ? value : null;
    };
    const toggle = this.toggle;
    if (changed("name")) {
      toggle.set_name(text("name"));
    }
    if (changed("label")) {
      toggle.set_label(text("label"));
    }
    if (changed("iconName")) {
      toggle.set_icon_name(text("iconName"));
    }
    if (changed("tooltip")) {
      toggle.set_tooltip(text("tooltip") ?? "");
    }
    if (changed("enabled")) {
      toggle.set_enabled(next["enabled"] !== false);
    }
  }

  placeIn(parent: WidgetNode, before: HostNode | null): void {
    const group = parent.widget instanceof AdwToggleGroup ? parent.widget : null;
    if (group === null) {
      throw new Error(`<${this.name()}> goes directly inside a <ToggleGroup>, not a <${parent.name()}>.`);
    }
    // Placed again, it is moving: out, then last.
    if (this.owner === parent) {
      group.remove(this.toggle);
    }
    this.owner = parent;
    group.add(this.toggle);
    if (before !== null) {
      this.appendFollowers(parent);
    }
    const name = this.props["name"];
    if (typeof name === "string" && parent.prop("activeName") === name) {
      const active: string = name;
      writeAsReact(() => group.set_active_name(active));
    }
  }
  takeOutOf(parent: WidgetNode): void {
    if (this.owner !== parent) {
      return;
    }
    const group = parent.widget instanceof AdwToggleGroup ? parent.widget : null;
    if (group !== null) {
      writeAsReact(() => group.remove(this.toggle));
    }
    this.owner = null;
  }
}

// ---- Sidebar -------------------------------------------------------------------------

export interface SidebarSectionProps {
  /** The heading over its items: none, if not given. */
  title?: string;
  children?: unknown;
}

export interface SidebarItemProps {
  title?: string;
  subtitle?: string;
  iconName?: string;
  tooltip?: string;
  /** Whether the user can select it: true, if not given. */
  enabled?: boolean;
  /** Whether it shows: true, if not given. */
  visible?: boolean;
  useUnderline?: boolean;
  /** Its one child: a widget shown at its end, its `suffix`. */
  children?: unknown;
}

export interface SidebarChildren {
  /** `<Sidebar.Section title>`: a section of the sidebar in React's order, holding its `<Sidebar.Item>`s. */
  readonly Section: HostComponent<"AdwSidebar.Section", SidebarSectionProps>;
  /** `<Sidebar.Item title iconName>`: an item of the section it is rendered in, in React's order. */
  readonly Item: HostComponent<"AdwSidebar.Item", SidebarItemProps>;
}

// The Sidebar's `selected` counts items across its sections, and applied
// before they existed it selected nothing: whenever React changes the items,
// the Sidebar selects the one its props name again. A change of items is
// React's, not the user's selecting.
function selectAsProps(owner: WidgetNode): void {
  const sidebar = owner.widget;
  const selected = owner.prop("selected");
  if (sidebar instanceof AdwSidebar && typeof selected === "number" && selected !== sidebar.get_selected()) {
    sidebar.set_selected(cUint(selected, "selected"));
  }
}

/**
 * A section of a Sidebar, holding the items rendered in it. Both the
 * Sidebar and a section insert by position, so a section or an item React
 * moves is taken out and inserted at its place in React's order.
 */
export class SidebarSectionNode extends ObjectElementNode {
  private readonly section: AdwSidebarSection = new AdwSidebarSection();
  private readonly items: SidebarItemNode[] = [];
  private owner: WidgetNode | null = null;

  applyProps(previous: Props | null, next: Props): void {
    const children = next["children"];
    if (typeof children === "string" || typeof children === "number") {
      throw new Error(`<${this.name()}> holds <Sidebar.Item>s: its text is its \`title\`.`);
    }
    if (previous === null || previous["title"] !== next["title"]) {
      const title = next["title"];
      this.section.set_title(typeof title === "string" ? title : null);
    }
  }

  appendChild(child: HostNode): void {
    this.insertAt(child, -1);
  }
  insertBefore(child: HostNode, before: HostNode): void {
    this.insertAt(child, before instanceof SidebarItemNode ? this.items.indexOf(before) : -1);
  }
  removeChild(child: HostNode): void {
    const at = child instanceof SidebarItemNode ? this.items.indexOf(child) : -1;
    if (at < 0) {
      return;
    }
    const item = this.items[at]!.item;
    this.items.splice(at, 1);
    writeAsReact(() => this.section.remove(item));
    this.reselect();
  }

  // At `at` among its items, or last for -1. Placed again, an item is moving:
  // out, then in at its place.
  private insertAt(child: HostNode, at: number): void {
    if (!(child instanceof SidebarItemNode)) {
      throw new Error(`<${this.name()}> holds <Sidebar.Item>s, not a <${child.name()}>.`);
    }
    const section = this.section;
    const item = child.item;
    const was = this.items.indexOf(child);
    if (was >= 0) {
      this.items.splice(was, 1);
      writeAsReact(() => section.remove(item));
      if (at > was) {
        at--;
      }
    }
    const position = at < 0 ? this.items.length : at;
    insertAt(this.items, position, child);
    writeAsReact(() => section.insert(item, cInt(position, "position")));
    this.reselect();
  }

  private reselect(): void {
    const owner = this.owner;
    if (owner !== null) {
      writeAsReact(() => selectAsProps(owner));
    }
  }

  placeIn(parent: WidgetNode, _before: HostNode | null): void {
    const sidebar = parent.widget instanceof AdwSidebar ? parent.widget : null;
    if (sidebar === null) {
      throw new Error(`<${this.name()}> goes directly inside a <Sidebar>, not a <${parent.name()}>.`);
    }
    const section = this.section;
    // WidgetNode has put it at its place in React's order: its position.
    const position = parent.positionOfKind(this);
    writeAsReact(() => {
      if (this.owner === parent) {
        sidebar.remove(section);
      }
      sidebar.insert(section, cInt(position, "position"));
      selectAsProps(parent);
    });
    this.owner = parent;
  }
  takeOutOf(parent: WidgetNode): void {
    if (this.owner !== parent) {
      return;
    }
    const sidebar = parent.widget instanceof AdwSidebar ? parent.widget : null;
    if (sidebar !== null) {
      writeAsReact(() => {
        sidebar.remove(this.section);
        selectAsProps(parent);
      });
    }
    this.owner = null;
  }
}

/**
 * An item of a Sidebar's section: its section places it (SidebarSectionNode).
 * Its one child, a widget, is its suffix.
 */
export class SidebarItemNode extends ObjectElementNode {
  readonly item: AdwSidebarItem = new AdwSidebarItem();
  private suffix: WidgetNode | null = null;

  appendChild(child: HostNode): void {
    const widget = child.widgetNode();
    if (widget === null) {
      throw new Error(`<${child.name()}> goes directly inside its widget, not in <${this.name()}>.`);
    }
    if (this.suffix !== null && this.suffix !== widget) {
      throw new Error(`<${this.name()}> holds one child at most: its suffix.`);
    }
    this.suffix = widget;
    this.item.set_suffix(widget.widget);
  }
  removeChild(child: HostNode): void {
    if (this.suffix === child) {
      this.item.set_suffix(null);
      this.suffix = null;
    }
  }

  // Only what changed is set.
  applyProps(previous: Props | null, next: Props): void {
    const children = next["children"];
    if (typeof children === "string" || typeof children === "number") {
      throw new Error(`<${this.name()}> holds a widget, its suffix: its text is its \`title\`.`);
    }
    const changed = (key: string): boolean => previous === null || previous[key] !== next[key];
    const text = (key: string): string | null => {
      const value = next[key];
      return typeof value === "string" ? value : null;
    };
    const item = this.item;
    if (changed("title")) {
      item.set_title(text("title"));
    }
    if (changed("subtitle")) {
      item.set_subtitle(text("subtitle"));
    }
    if (changed("iconName")) {
      item.set_icon_name(text("iconName"));
    }
    if (changed("tooltip")) {
      item.set_tooltip(text("tooltip"));
    }
    if (changed("enabled")) {
      item.set_enabled(next["enabled"] !== false);
    }
    if (changed("visible")) {
      item.set_visible(next["visible"] !== false);
    }
    if (changed("useUnderline")) {
      item.set_use_underline(next["useUnderline"] === true);
    }
  }

  placeIn(parent: WidgetNode, _before: HostNode | null): void {
    throw new Error(`<${this.name()}> goes inside a <Sidebar.Section>, not directly in a <${parent.name()}>.`);
  }
  takeOutOf(_parent: WidgetNode): void {}
}

// ---- ToastOverlay --------------------------------------------------------------------

export interface ToastProps {
  title?: string;
  /** Seconds it shows for: 5 if not given, and 0 until it is dismissed. */
  timeout?: number;
  priority?: AdwToastPriority;
  /** The text of its button, if it has one. */
  buttonLabel?: string;
  useMarkup?: boolean;
  /** The user dismissed it, or its time ran out: the app stops rendering it. */
  onDismissed?: () => void;
  /** The user pressed its button. */
  onButtonClicked?: () => void;
}

export interface ToastOverlayChildren {
  /** `<ToastOverlay.Toast title timeout onDismissed>`: a toast the overlay shows while it is rendered. */
  readonly Toast: HostComponent<"AdwToastOverlay.Toast", ToastProps>;
}

// What the toast's handlers read. The toast holds the handlers, so they hold
// this and not the node, which holds the toast.
class ToastState {
  readonly onDismissed: SignalSlot = new SignalSlot();
  readonly onButtonClicked: SignalSlot = new SignalSlot();
  // Whether the element is placed: a toast React took out reports nothing.
  placed = false;
}

/**
 * A toast of a ToastOverlay, shown while React renders it: placed, it is
 * added to the overlay, and taken out, it is dismissed. A user dismissing
 * it, or its time running out, is heard as `onDismissed`, and the app stops
 * rendering it; rendered again under a new key, it is a new toast. Toasts
 * have no order, so a move changes nothing.
 */
export class ToastNode extends ObjectElementNode {
  private readonly toast: AdwToast = new AdwToast();
  private readonly state: ToastState = new ToastState();
  private owner: WidgetNode | null = null;

  constructor(type: string) {
    super(type);
    const state = this.state;
    this.toast.connect("dismissed", () => {
      if (state.placed && !isReactWriting()) {
        state.onDismissed.fire();
      }
    });
    this.toast.connect("button-clicked", () => {
      if (state.placed) {
        state.onButtonClicked.fire();
      }
    });
  }

  applyProps(previous: Props | null, next: Props): void {
    if (next["children"] !== undefined) {
      throw new Error(`<${this.name()}> holds no children: its text is its \`title\`.`);
    }
    const changed = (key: string): boolean => previous === null || previous[key] !== next[key];
    const toast = this.toast;
    if (changed("title")) {
      const title = next["title"];
      toast.set_title(typeof title === "string" ? title : "");
    }
    if (changed("timeout")) {
      const timeout = next["timeout"];
      toast.set_timeout(cUint(typeof timeout === "number" ? timeout : 5, "timeout"));
    }
    if (changed("priority")) {
      const priority = next["priority"];
      toast.set_priority(cUint(typeof priority === "number" ? priority : 0, "priority"));
    }
    if (changed("buttonLabel")) {
      const label = next["buttonLabel"];
      toast.set_button_label(typeof label === "string" ? label : null);
    }
    if (changed("useMarkup")) {
      toast.set_use_markup(next["useMarkup"] === true);
    }
    const onDismissed = next["onDismissed"];
    if (typeof onDismissed === "function") {
      this.state.onDismissed.handler = onDismissed;
    } else {
      this.state.onDismissed.handler = null;
    }
    const onButtonClicked = next["onButtonClicked"];
    if (typeof onButtonClicked === "function") {
      this.state.onButtonClicked.handler = onButtonClicked;
    } else {
      this.state.onButtonClicked.handler = null;
    }
  }

  placeIn(parent: WidgetNode, _before: HostNode | null): void {
    const overlay = parent.widget instanceof AdwToastOverlay ? parent.widget : null;
    if (overlay === null) {
      throw new Error(`<${this.name()}> goes directly inside a <ToastOverlay>, not a <${parent.name()}>.`);
    }
    if (this.owner === parent) {
      return;
    }
    this.owner = parent;
    this.state.placed = true;
    overlay.add_toast(this.toast);
  }
  takeOutOf(parent: WidgetNode): void {
    if (this.owner !== parent) {
      return;
    }
    this.owner = null;
    this.state.placed = false;
    const toast = this.toast;
    writeAsReact(() => toast.dismiss());
  }

  detachDeleted(): void {
    this.state.onDismissed.handler = null;
    this.state.onButtonClicked.handler = null;
  }
}
