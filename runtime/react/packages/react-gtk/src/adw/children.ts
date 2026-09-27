// libadwaita's containers that place children in groups, as GTK's bars do
// (../children.ts): a group element holds any number of widgets, placed where
// its name says.
//
//   <HeaderBar><HeaderBar.Start><Button /></HeaderBar.Start></HeaderBar>
//   <ToolbarView><ToolbarView.Top><HeaderBar /></ToolbarView.Top>...</ToolbarView>
//   <ActionRow title="Wi-Fi"><ActionRow.Suffix><Switch /></ActionRow.Suffix></ActionRow>
//   <ViewStack><ViewStack.Page name="inbox" title="Inbox" iconName="mail-symbolic">...</ViewStack.Page></ViewStack>
//   <TabView><TabView.Page title="Notes" onClose={() => close(id)}>...</TabView.Page></TabView>
//
// Each is a GroupNode with a placement of libadwaita's, so GTK's module never
// names an Adw class. A row's subclasses (a SwitchRow is an ActionRow) take
// their ancestor's groups.

import {
  AdwActionRow,
  AdwExpanderRow,
  AdwHeaderBar,
  AdwTabView,
  AdwToolbarView,
  AdwViewStack,
  type AdwTabPage,
  type AdwViewStackPage,
} from "c:Adw-1";
import { g_signal_handler_disconnect } from "c:GObject-2.0";
import type { GtkWidget } from "c:Gtk-4.0";
import type { HostComponent } from "shared/ReactHostComponent.ts";

import { GroupNode, GroupPlacement, type PackProps } from "../children.ts";
import { PlacedNode, scheduleRestore, SignalSlot, type WidgetNode } from "../HostNode.ts";

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

// Above zero while React changes which tab is selected: selecting a tab from
// props, or closing the selected one, after which libadwaita selects
// another. The user did neither, so no tab's `onSelect` hears it.
let selectingByReact = 0;

function selectByReact(view: AdwTabView, page: AdwTabPage): void {
  if (view.get_selected_page() !== page) {
    selectingByReact++;
    view.set_selected_page(page);
    selectingByReact--;
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
    const next = this.nextIn(view);
    const page = next === null ? view.append(widget) : view.insert(widget, view.get_page_position(next));
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
      if (notified === null || selectingByReact > 0) {
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
    const view = owner.widget;
    if (!(view instanceof AdwTabView)) {
      return;
    }
    g_signal_handler_disconnect(view, this.selectHandler);
    this.state.closingByReact = true;
    selectingByReact++;
    view.close_page(view.get_page(widget));
    selectingByReact--;
    this.state.closingByReact = false;
    g_signal_handler_disconnect(view, this.closeHandler);
  }
  protected move(owner: WidgetNode, widget: GtkWidget): boolean {
    const view = owner.widget;
    if (!(view instanceof AdwTabView)) {
      return false;
    }
    const page = view.get_page(widget);
    const from = view.get_page_position(page);
    // The tab goes where the next one is (past the end, with none), counted
    // with this one taken out: a tab after it moves up one.
    const next = this.nextIn(view);
    const to = next === null ? view.get_n_pages() : view.get_page_position(next);
    view.reorder_page(page, to > from ? to - 1 : to);
    return true;
  }
  protected update(owner: WidgetNode, widget: GtkWidget): void {
    const view = owner.widget;
    if (view instanceof AdwTabView) {
      this.describe(view, view.get_page(widget));
    }
  }

  // The tab React places this one before, or null for the end.
  private nextIn(view: AdwTabView): AdwTabPage | null {
    const next = this.before === null ? null : this.before.shownWidget();
    return next === null ? null : view.get_page(next);
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
