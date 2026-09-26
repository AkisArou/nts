// Input as signal props on every widget. GTK 4 delivers keys, clicks, pointer
// motion and scrolling through event controllers added to a widget, not
// through the widget's own signals:
//
//   <Entry onKeyPressed={(keyval) => keyval === KEY_Escape} />
//   <Box onClickPressed={(nPress) => select(nPress === 2)} />
//
// A widget gets each kind of controller on the first prop that needs it, and
// keeps it: the props of one kind share it, and a removed handler only stops
// firing, as a widget signal's does (HostNode.ts, SignalSlot). GIR does not
// say which controllers an app wants, so these are written by hand; the
// generator makes every widget's props extend ControllerProps.

import {
  EventControllerScrollFlags,
  GtkEventControllerKey,
  GtkEventControllerMotion,
  GtkEventControllerScroll,
  GtkGestureClick,
  type GtkWidget,
} from "c:Gtk-4.0";
import type { GdkModifierType } from "c:Gdk-4.0";

import type { SignalSlot } from "./HostNode.ts";

export interface ControllerProps {
  /** A key went down; answer whether it was handled (GtkEventControllerKey `key-pressed`). */
  onKeyPressed?: (keyval: number, keycode: number, state: GdkModifierType) => boolean;
  /** A key went up. */
  onKeyReleased?: (keyval: number, keycode: number, state: GdkModifierType) => void;
  /** A pointer button went down, the `nPress`th in a row (GtkGestureClick `pressed`). */
  onClickPressed?: (nPress: number, x: number, y: number) => void;
  /** A pointer button went up. */
  onClickReleased?: (nPress: number, x: number, y: number) => void;
  /** The pointer entered the widget (GtkEventControllerMotion `enter`). */
  onPointerEnter?: (x: number, y: number) => void;
  /** The pointer left the widget. */
  onPointerLeave?: () => void;
  /** The pointer moved over the widget. */
  onPointerMotion?: (x: number, y: number) => void;
  /** A scroll, in both axes; answer whether it was handled (GtkEventControllerScroll `scroll`). */
  onScroll?: (dx: number, dy: number) => boolean;
}

/** A widget's controllers, one of each kind, made on the first prop that needs it. */
export class Controllers {
  private key: GtkEventControllerKey | null = null;
  private click: GtkGestureClick | null = null;
  private motion: GtkEventControllerMotion | null = null;
  private scroll: GtkEventControllerScroll | null = null;

  keyOf(widget: GtkWidget): GtkEventControllerKey {
    let key = this.key;
    if (key === null) {
      key = new GtkEventControllerKey();
      widget.add_controller(key);
      this.key = key;
    }
    return key;
  }

  clickOf(widget: GtkWidget): GtkGestureClick {
    let click = this.click;
    if (click === null) {
      click = new GtkGestureClick();
      widget.add_controller(click);
      this.click = click;
    }
    return click;
  }

  motionOf(widget: GtkWidget): GtkEventControllerMotion {
    let motion = this.motion;
    if (motion === null) {
      motion = new GtkEventControllerMotion();
      widget.add_controller(motion);
      this.motion = motion;
    }
    return motion;
  }

  scrollOf(widget: GtkWidget): GtkEventControllerScroll {
    let scroll = this.scroll;
    if (scroll === null) {
      scroll = new GtkEventControllerScroll({ flags: EventControllerScrollFlags.BOTH_AXES });
      widget.add_controller(scroll);
      this.scroll = scroll;
    }
    return scroll;
  }
}

/** Connects the controller signal prop `key` of `widget` to `slot`; false if there is no such prop. */
export function connectController(widget: GtkWidget, controllers: Controllers, key: string, slot: SignalSlot): boolean {
  switch (key) {
    case "onKeyPressed":
      controllers
        .keyOf(widget)
        .connect("key-pressed", (_self, keyval, keycode, state) =>
          slot.decide(() => (slot.handler as NonNullable<ControllerProps["onKeyPressed"]>)(keyval, keycode, state)),
        );
      return true;
    case "onKeyReleased":
      controllers.keyOf(widget).connect("key-released", (_self, keyval, keycode, state) => {
        slot.dispatch(() => (slot.handler as NonNullable<ControllerProps["onKeyReleased"]>)(keyval, keycode, state));
      });
      return true;
    case "onClickPressed":
      controllers.clickOf(widget).connect("pressed", (_self, nPress, x, y) => {
        slot.dispatch(() => (slot.handler as NonNullable<ControllerProps["onClickPressed"]>)(nPress, x, y));
      });
      return true;
    case "onClickReleased":
      controllers.clickOf(widget).connect("released", (_self, nPress, x, y) => {
        slot.dispatch(() => (slot.handler as NonNullable<ControllerProps["onClickReleased"]>)(nPress, x, y));
      });
      return true;
    case "onPointerEnter":
      controllers.motionOf(widget).connect("enter", (_self, x, y) => {
        slot.dispatch(() => (slot.handler as NonNullable<ControllerProps["onPointerEnter"]>)(x, y));
      });
      return true;
    case "onPointerLeave":
      controllers.motionOf(widget).connect("leave", () => slot.fire());
      return true;
    case "onPointerMotion":
      controllers.motionOf(widget).connect("motion", (_self, x, y) => {
        slot.dispatch(() => (slot.handler as NonNullable<ControllerProps["onPointerMotion"]>)(x, y));
      });
      return true;
    case "onScroll":
      controllers
        .scrollOf(widget)
        .connect("scroll", (_self, dx, dy) =>
          slot.decide(() => (slot.handler as NonNullable<ControllerProps["onScroll"]>)(dx, dy)),
        );
      return true;
  }
  return false;
}
