// libadwaita's containers that place children in groups, as GTK's bars do
// (../children.ts): a group element holds any number of widgets, placed where
// its name says.
//
//   <HeaderBar><HeaderBar.Start><Button /></HeaderBar.Start></HeaderBar>
//   <ToolbarView><ToolbarView.Top><HeaderBar /></ToolbarView.Top>...</ToolbarView>
//   <ActionRow title="Wi-Fi"><ActionRow.Suffix><Switch /></ActionRow.Suffix></ActionRow>
//
// Each is a GroupNode with a placement of libadwaita's, so GTK's module never
// names an Adw class. A row's subclasses (a SwitchRow is an ActionRow) take
// their ancestor's groups.

import { AdwActionRow, AdwExpanderRow, AdwHeaderBar, AdwToolbarView } from "c:Adw-1";
import type { HostComponent } from "shared/ReactHostComponent.ts";

import { GroupNode, GroupPlacement, type PackProps } from "../children.ts";

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
