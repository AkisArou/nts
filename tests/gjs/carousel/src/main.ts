// Workbench's "Carousel" demo (CC0, workbenchdev/demos), ported.
import { AdwCarousel, AdwCarouselIndicatorDots, AdwCarouselIndicatorLines, AdwComboRow, AdwSwitchRow } from "c:Adw-1";
import { GtkBox, Orientation } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const root_box = workbench.builder.get_object("root_box");
  const carousel = workbench.builder.get_object("carousel");
  const ls_switch = workbench.builder.get_object("ls_switch");
  const sw_switch = workbench.builder.get_object("sw_switch");
  const indicator_row = workbench.builder.get_object("indicator_row");
  const orientation_row = workbench.builder.get_object("orientation_row");
  if (
    !(root_box instanceof GtkBox) ||
    !(carousel instanceof AdwCarousel) ||
    !(ls_switch instanceof AdwSwitchRow) ||
    !(sw_switch instanceof AdwSwitchRow) ||
    !(indicator_row instanceof AdwComboRow) ||
    !(orientation_row instanceof AdwComboRow)
  ) {
    throw new Error("the demo's UI");
  }
  let indicators: AdwCarouselIndicatorDots | AdwCarouselIndicatorLines;

  carousel.connect("page-changed", () => {
    console.log("Page Changed");
  });

  // Scroll Wheel Switch
  sw_switch.active = carousel.allow_scroll_wheel;

  sw_switch.connect("notify::active", () => {
    carousel.allow_scroll_wheel = sw_switch.active;
  });

  // Long Swipe Switch
  ls_switch.active = carousel.allow_long_swipes;

  ls_switch.connect("notify::active", () => {
    carousel.allow_long_swipes = ls_switch.active;
  });

  if (indicator_row.get_selected() === 0) {
    indicators = new AdwCarouselIndicatorDots({ carousel: carousel });
  } else {
    indicators = new AdwCarouselIndicatorLines({ carousel: carousel });
  }

  indicators.orientation = carousel.orientation;
  root_box.append(indicators);

  indicator_row.connect("notify::selected-item", () => {
    root_box.remove(indicators);

    if (indicator_row.get_selected() === 0) {
      indicators = new AdwCarouselIndicatorDots({ carousel: carousel });
    } else {
      indicators = new AdwCarouselIndicatorLines({ carousel: carousel });
    }

    indicators.orientation = carousel.orientation;
    root_box.append(indicators);
  });

  orientation_row.connect("notify::selected-item", () => {
    if (orientation_row.get_selected() === 0) {
      root_box.orientation = Orientation.VERTICAL;
      carousel.orientation = Orientation.HORIZONTAL;
      indicators.orientation = Orientation.HORIZONTAL;
    } else {
      root_box.orientation = Orientation.HORIZONTAL;
      carousel.orientation = Orientation.VERTICAL;
      indicators.orientation = Orientation.VERTICAL;
    }
  });
}

run(demo);
