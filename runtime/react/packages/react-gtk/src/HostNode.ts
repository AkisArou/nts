// What React holds for a host element: a HostNode, of one of two kinds.
//
//   WidgetNode  a widget: `<Button>`. src/widgets.ts generates a subclass per
//               GTK widget, which knows its own props, signals and how it
//               holds children; WidgetNode is what they share.
//   SlotNode    a slot element: `<Paned.StartChild>`, which places its one
//               child in a widget-typed property of the widget it is in (a
//               Paned's start child, a window's titlebar) rather than among
//               that widget's children.
//
// A WidgetNode holds the widget as a GtkWidget, which is all a parent or the
// window needs. Each subclass also holds it typed as what it is, in its own
// `gtk` field, so its setters are the widget's own methods, with no cast.

import type { GtkWidget } from "c:Gtk-4.0";
import { g_idle_add_full } from "c:GLib-2.0";

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

// A handler hears the user, not React's own writes: setting `text` or
// `active` from props makes GTK emit `notify::text` or `toggled`, and React
// DOM does not call `onChange` for the value it sets either. So nothing is
// dispatched while props are being applied.
let applyingProps = 0;

// What runs between a user's change and putting a controlled prop back: the
// reconciler's sync flush, so that state the handler set is committed first,
// as React DOM flushes before restoreControlledState. A root installs it
// (`flushSyncWork`); this module does not import the reconciler.
// Controlled props are put back once GTK's own change is over: a user's edit
// can notify more than once (an Entry's text is cleared, then set), and
// restoring inside it would edit the widget mid-edit. So restores queue and
// run from one idle source, after the flush. A holder, not module-scope
// `let`s, which nts cannot hold functions in.
class Restores {
  flush: (() => void) | null = null;
  queue: (() => void)[] = [];
  scheduled = false;
}

const restores = new Restores();

// G_PRIORITY_HIGH_IDLE, as the scheduler's work: after input, before redraw.
const PRIORITY_HIGH_IDLE = 100;

export function setAfterEvent(flush: () => void): void {
  restores.flush = flush;
}

function scheduleRestore(restore: () => void): void {
  restores.queue.push(restore);
  if (restores.scheduled) {
    return;
  }
  restores.scheduled = true;
  g_idle_add_full(PRIORITY_HIGH_IDLE, () => {
    restores.scheduled = false;
    const flush = restores.flush;
    if (flush !== null) {
      flush();
    }
    const queue = restores.queue;
    restores.queue = [];
    for (let i = 0; i < queue.length; i++) {
      queue[i]!();
    }
    return false;
  });
}

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
    if (handler !== null && applyingProps === 0) {
      discreteEvent(handler as () => void);
    }
  }

  /**
   * A signal whose handler says whether it handled it: runs `call`, which asks
   * the handler; with no handler, not handled, so GTK's own default runs.
   */
  decide(call: () => boolean): boolean {
    if (this.handler === null || applyingProps > 0) {
      return false;
    }
    const previous = getCurrentUpdatePriority();
    setCurrentUpdatePriority(DiscreteEventPriority);
    const handled = call();
    setCurrentUpdatePriority(previous);
    return handled;
  }

  /**
   * For a controlled prop's `notify::`, set by the node: puts the widget back
   * to what the props say, once the change and what it updated are done.
   */
  restore: (() => void) | null = null;

  /** A signal with arguments: runs `call`, which passes them to the handler. */
  dispatch(call: () => void): void {
    if (applyingProps > 0) {
      return;
    }
    if (this.handler !== null) {
      discreteEvent(call);
    }
    const restore = this.restore;
    if (restore !== null) {
      scheduleRestore(restore);
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

// ---- the nodes --------------------------------------------------------------------

/** What React holds for a host element: the host config's `Instance`. */
export abstract class HostNode {
  /** The host type React created it for: `GtkButton`, `GtkPaned.StartChild`. */
  readonly type: string;

  constructor(type: string) {
    this.type = type;
  }

  /** Applies `next`, the props after `previous` (null on creation). */
  abstract applyProps(previous: Props | null, next: Props): void;

  abstract appendChild(child: HostNode): void;
  abstract insertBefore(child: HostNode, before: HostNode): void;
  abstract removeChild(child: HostNode): void;

  /**
   * Places this node in the widget `parent`, before `before` (null: last):
   * a widget among its children, a slot element in its slot. Each kind
   * places itself, so a parent never asks which kind a child is.
   */
  abstract placeIn(parent: WidgetNode, before: HostNode | null): void;
  /** Takes this node back out of `parent`. */
  abstract takeOutOf(parent: WidgetNode): void;

  /** This node as a widget's, or null for a slot element. */
  abstract widgetNode(): WidgetNode | null;

  /** What a ref to the element holds: a widget. */
  abstract publicInstance(): GtkWidget;

  /** Shows or hides what the element shows, as Suspense and Activity do. */
  abstract setVisible(visible: boolean): void;

  /** The JSX name: `Button` for `GtkButton`. */
  name(): string {
    return this.type.startsWith("Gtk") ? this.type.slice(3) : this.type;
  }
}

/** A widget's node. */
export abstract class WidgetNode extends HostNode {
  readonly widget: GtkWidget;
  private slots: Map<string, SignalSlot> | null = null;
  // The props last applied: a controlled prop is put back to its value here.
  private props: Props | null = null;
  // The one child a single-child widget holds.
  private only: WidgetNode | null = null;

  constructor(type: string, widget: GtkWidget) {
    super(type);
    this.widget = widget;
  }

  /** Sets the prop `key`, or restores its default for `undefined`; false if the widget has no such prop. */
  abstract setProp(key: string, value: unknown): boolean;

  /** Connects the signal prop `key` to `slot`; false if the widget has no such signal. */
  abstract connectSignal(key: string, slot: SignalSlot): boolean;

  /**
   * Puts `widget` in the widget slot `slot` (a slot element's host type,
   * `GtkPaned.StartChild`), or empties it for null; false if the widget has no
   * such slot.
   */
  fillSlot(_slot: string, _widget: GtkWidget | null): boolean {
    return false;
  }

  /**
   * The widget's own value of the controlled prop `key` (Entry's `text`, a
   * CheckButton's `active`), or undefined when `key` is not one: the user
   * changes these, and a prop given to them holds them.
   */
  readControlled(_key: string): unknown {
    return undefined;
  }

  publicInstance(): GtkWidget {
    return this.widget;
  }

  setVisible(visible: boolean): void {
    this.widget.set_visible(visible);
  }

  widgetNode(): WidgetNode | null {
    return this;
  }
  /** Applies `next`, the props after `previous` (null on creation). */
  applyProps(previous: Props | null, next: Props): void {
    // What is wrong is thrown once the props are applied and dispatch is on
    // again, so a bad prop cannot leave every handler silenced.
    applyingProps++;
    const error = this.applyAll(previous, next);
    this.props = next;
    applyingProps--;
    if (error !== null) {
      throw new Error(error);
    }
  }

  /** Applies the props, returning the first thing wrong with them, or null. */
  private applyAll(previous: Props | null, next: Props): string | null {
    let error: string | null = null;
    // A prop that is gone restores its default -- first, as React DOM does,
    // since two props can reach one setter (text children and `label`).
    // React treats a prop set to undefined as absent, so the value's absence
    // is the test.
    if (previous !== null) {
      for (const key in previous) {
        if (next[key] === undefined && previous[key] !== undefined) {
          error = error ?? this.apply(key, undefined);
        }
      }
    }
    for (const key in next) {
      const value = next[key];
      if (value !== undefined && (previous === null || previous[key] !== value)) {
        error = error ?? this.apply(key, value);
      }
    }
    return error;
  }

  /** Applies one prop, or says what is wrong with it. */
  private apply(key: string, value: unknown): string | null {
    if (key === "children") {
      // Text children are a widget's label: GTK has no bare text.
      const text = typeof value === "string" || typeof value === "number" ? String(value) : undefined;
      if (!this.setProp("label", text) && text !== undefined) {
        return `<${this.name()}> cannot hold text: put it in a <Label>.`;
      }
      return null;
    }
    if (isSignalProp(key)) {
      return this.handle(key, value);
    }
    if (!this.setProp(key, value)) {
      return `<${this.name()}> has no prop \`${key}\`.`;
    }
    if (value !== undefined && this.readControlled(key) !== undefined) {
      return this.control(key);
    }
    return null;
  }

  // Listens for the user changing the controlled prop `key`, whether or not
  // the props hold an onNotify handler for it.
  private control(key: string): string | null {
    const signal = "onNotify" + key.charAt(0).toUpperCase() + key.slice(1);
    const slot = this.slot(signal);
    if (slot === null) {
      return `<${this.name()}> has no signal for \`${signal}\`.`;
    }
    if (slot.restore === null) {
      slot.restore = () => this.restoreProp(key);
    }
    return null;
  }

  private restoreProp(key: string): void {
    const wanted = this.props === null ? undefined : this.props[key];
    if (wanted !== undefined && this.readControlled(key) !== wanted) {
      applyingProps++;
      this.setProp(key, wanted);
      applyingProps--;
    }
  }

  private handle(key: string, value: unknown): string | null {
    if (typeof value !== "function") {
      const slot = this.slots === null ? undefined : this.slots.get(key);
      if (slot !== undefined) {
        slot.handler = null;
      }
      return null;
    }
    const slot = this.slot(key);
    if (slot === null) {
      return `<${this.name()}> has no signal for \`${key}\`.`;
    }
    slot.handler = value;
    return null;
  }

  /** The slot of the signal prop `key`, connected the first time; null if there is no such signal. */
  private slot(key: string): SignalSlot | null {
    let slots = this.slots;
    if (slots === null) {
      slots = new Map<string, SignalSlot>();
      this.slots = slots;
    }
    let slot = slots.get(key);
    if (slot === undefined) {
      slot = new SignalSlot();
      if (!this.connectSignal(key, slot)) {
        return null;
      }
      slots.set(key, slot);
    }
    return slot;
  }

  appendChild(child: HostNode): void {
    child.placeIn(this, null);
  }
  insertBefore(child: HostNode, before: HostNode): void {
    child.placeIn(this, before);
  }
  removeChild(child: HostNode): void {
    child.takeOutOf(this);
  }

  // A widget goes among its parent's children, by the parent's protocol.
  placeIn(parent: WidgetNode, before: HostNode | null): void {
    // Before a slot element is last among the children: only single-child
    // widgets have slots (the generator checks), and they hold one.
    const sibling = before === null ? null : before.widgetNode();
    if (sibling === null) {
      parent.place(this);
    } else {
      parent.placeBefore(this, sibling);
    }
  }
  takeOutOf(parent: WidgetNode): void {
    parent.unplace(this);
  }

  // A widget holds children by its own protocol; one without one refuses them.
  protected place(_child: WidgetNode): void {
    throw new Error(`<${this.name()}> takes no children.`);
  }
  protected placeBefore(_child: WidgetNode, _before: WidgetNode): void {
    throw new Error(`<${this.name()}> holds one child at most.`);
  }
  protected unplace(_child: WidgetNode): void {
    throw new Error(`<${this.name()}> takes no children.`);
  }

  /** For a single-child widget: `child` is the one it holds, or it throws. */
  protected holdOnly(child: WidgetNode): void {
    if (this.only !== null && this.only !== child) {
      throw new Error(`<${this.name()}> holds one child at most: wrap its children in a <Box>.`);
    }
    this.only = child;
  }
  protected release(child: WidgetNode): void {
    if (this.only === child) {
      this.only = null;
    }
  }
}

/**
 * A slot element, `<Paned.StartChild>`: its one child fills the widget slot
 * its host type names, in the widget the element is in. The child arrives
 * before the element is placed (React completes children first), so each
 * side fills the slot once both are there, and empties it when either goes.
 */
export class SlotNode extends HostNode {
  private owner: WidgetNode | null = null;
  private child: WidgetNode | null = null;

  applyProps(_previous: Props | null, next: Props): void {
    const children = next["children"];
    if (typeof children === "string" || typeof children === "number") {
      throw new Error(`<${this.name()}> cannot hold text: put it in a <Label>.`);
    }
  }

  appendChild(child: HostNode): void {
    const widget = child.widgetNode();
    if (widget === null) {
      throw new Error(`<${child.name()}> goes directly inside its widget, not in <${this.name()}>.`);
    }
    if (this.child !== null && this.child !== widget) {
      throw new Error(`<${this.name()}> holds one child at most.`);
    }
    this.child = widget;
    this.fill();
  }
  insertBefore(child: HostNode, _before: HostNode): void {
    this.appendChild(child);
  }
  removeChild(child: HostNode): void {
    if (this.child === child) {
      this.child = null;
      this.fill();
    }
  }

  // A slot element's place among its parent's children is no place in GTK:
  // it fills the slot, wherever it is.
  placeIn(parent: WidgetNode, _before: HostNode | null): void {
    this.owner = parent;
    this.fill();
  }
  takeOutOf(parent: WidgetNode): void {
    if (this.owner === parent) {
      parent.fillSlot(this.type, null);
      this.owner = null;
    }
  }

  widgetNode(): WidgetNode | null {
    return null;
  }

  private fill(): void {
    const owner = this.owner;
    const child = this.child;
    if (owner !== null && !owner.fillSlot(this.type, child === null ? null : child.widget)) {
      throw new Error(`<${owner.name()}> has no slot <${this.name()}>.`);
    }
  }

  publicInstance(): GtkWidget {
    const child = this.child;
    if (child === null) {
      throw new Error(`<${this.name()}> is empty: a ref to it has no widget.`);
    }
    return child.widget;
  }

  setVisible(visible: boolean): void {
    const child = this.child;
    if (child !== null) {
      child.setVisible(visible);
    }
  }
}
