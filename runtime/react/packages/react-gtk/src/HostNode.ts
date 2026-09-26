// What every host node is, whatever its widget: src/widgets.ts generates a
// subclass per GTK widget, which knows its own props, signals and how it holds
// children; this is what they share.
//
// The base holds the widget as a GtkWidget, which is all a parent or the
// window needs. Each subclass also holds it typed as what it is, in its own
// `gtk` field, so its setters are the widget's own methods, with no cast.

import type { GtkWidget } from "c:Gtk-4.0";

export type Props = { [key: string]: unknown };

// ---- update priority -------------------------------------------------------------

// A signal handler runs at DiscreteEventPriority, as React DOM's
// dispatchDiscreteEvent runs a click, so a click is a discrete update.
export const NoEventPriority = 0;
export const DiscreteEventPriority = 2;

let currentUpdatePriority = NoEventPriority;

export function setCurrentUpdatePriority(newPriority: number): void {
  currentUpdatePriority = newPriority;
}
export function getCurrentUpdatePriority(): number {
  return currentUpdatePriority;
}

// No `finally`: a handler runs from a GTK signal, below C frames a throw
// cannot cross, so a handler that throws ends the program and there is no
// priority left to restore.
function discreteEvent(handler: () => void): void {
  const previous = currentUpdatePriority;
  currentUpdatePriority = DiscreteEventPriority;
  handler();
  currentUpdatePriority = previous;
}

// ---- signals ----------------------------------------------------------------------

/**
 * The handler a signal prop holds. The widget's signal is connected once, to
 * a trampoline that fires whatever handler the props hold now: a re-render
 * with a new closure -- the common case -- changes this field and never
 * reconnects, and a removed prop leaves it null.
 */
export class SignalSlot {
  // The prop's handler, erased: each signal's trampoline reads it back as
  // the handler type its prop declares.
  handler: unknown = null;

  /** A signal without arguments: calls the handler. */
  fire(): void {
    const handler = this.handler;
    if (handler !== null) {
      discreteEvent(handler as () => void);
    }
  }

  /** A signal with arguments: runs `call`, which passes them to the handler. */
  dispatch(call: () => void): void {
    if (this.handler !== null) {
      discreteEvent(call);
    }
  }
}

/** `onClicked`, not `one` or `only`. */
function isSignalProp(key: string): boolean {
  if (key.length < 3 || !key.startsWith("on")) {
    return false;
  }
  const third = key.charAt(2);
  return third >= "A" && third <= "Z";
}

// ---- a list container's children ----------------------------------------------------

/** Puts `item` at `index` in `items`, moving what follows up by one. */
export function insertAt<T>(items: T[], index: number, item: T): void {
  items.push(item);
  for (let i = items.length - 1; i > index; i--) {
    items[i] = items[i - 1]!;
  }
  items[index] = item;
}

// ---- the node ---------------------------------------------------------------------

export abstract class HostNode {
  /** The host type React created it for: `GtkButton`. */
  readonly type: string;
  readonly widget: GtkWidget;
  private slots: Map<string, SignalSlot> | null = null;
  // The one child a single-child widget holds.
  private only: HostNode | null = null;

  constructor(type: string, widget: GtkWidget) {
    this.type = type;
    this.widget = widget;
  }

  /** Sets the prop `key`, or restores its default for `undefined`; false if the widget has no such prop. */
  abstract setProp(key: string, value: unknown): boolean;

  /** Connects the signal prop `key` to `slot`; false if the widget has no such signal. */
  abstract connectSignal(key: string, slot: SignalSlot): boolean;

  /** Applies `next`, the props after `previous` (null on creation). */
  applyProps(previous: Props | null, next: Props): void {
    // A prop that is gone restores its default -- first, as React DOM does,
    // since two props can reach one setter (text children and `label`).
    // React treats a prop set to undefined as absent, so the value's absence
    // is the test.
    if (previous !== null) {
      for (const key in previous) {
        if (next[key] === undefined && previous[key] !== undefined) {
          this.apply(key, undefined);
        }
      }
    }
    for (const key in next) {
      const value = next[key];
      if (value !== undefined && (previous === null || previous[key] !== value)) {
        this.apply(key, value);
      }
    }
  }

  private apply(key: string, value: unknown): void {
    if (key === "children") {
      // Text children are a widget's label: GTK has no bare text.
      const text = typeof value === "string" || typeof value === "number" ? String(value) : undefined;
      if (!this.setProp("label", text) && text !== undefined) {
        throw new Error(`<${this.name()}> cannot hold text: put it in a <Label>.`);
      }
    } else if (isSignalProp(key)) {
      this.handle(key, value);
    } else if (!this.setProp(key, value)) {
      throw new Error(`<${this.name()}> has no prop \`${key}\`.`);
    }
  }

  private handle(key: string, value: unknown): void {
    let slots = this.slots;
    if (slots === null) {
      slots = new Map<string, SignalSlot>();
      this.slots = slots;
    }
    let slot = slots.get(key);
    if (typeof value !== "function") {
      if (slot !== undefined) {
        slot.handler = null;
      }
      return;
    }
    if (slot === undefined) {
      slot = new SignalSlot();
      if (!this.connectSignal(key, slot)) {
        throw new Error(`<${this.name()}> has no signal for \`${key}\`.`);
      }
      slots.set(key, slot);
    }
    slot.handler = value;
  }

  /** The JSX name: `Button` for `GtkButton`. */
  name(): string {
    return this.type.startsWith("Gtk") ? this.type.slice(3) : this.type;
  }

  // A widget holds children by its own protocol; one without one refuses them.
  appendChild(_child: HostNode): void {
    throw new Error(`<${this.name()}> takes no children.`);
  }
  insertBefore(_child: HostNode, _before: HostNode): void {
    throw new Error(`<${this.name()}> holds one child at most.`);
  }
  removeChild(_child: HostNode): void {
    throw new Error(`<${this.name()}> takes no children.`);
  }

  /** For a single-child widget: `child` is the one it holds, or it throws. */
  protected holdOnly(child: HostNode): void {
    if (this.only !== null && this.only !== child) {
      throw new Error(`<${this.name()}> holds one child at most: wrap its children in a <Box>.`);
    }
    this.only = child;
  }
  protected release(child: HostNode): void {
    if (this.only === child) {
      this.only = null;
    }
  }
}
