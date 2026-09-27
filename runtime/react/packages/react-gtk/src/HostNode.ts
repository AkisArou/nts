// What React holds for a host element: a HostNode, of one of two kinds.
//
//   WidgetNode  a widget: `<Button>`. src/widgets.ts generates a subclass per
//               GTK widget, which knows its own props, signals and how it
//               holds children; WidgetNode is what they share.
//   PlacedNode  an element that holds one widget and places it in the
//               widget it is in by a protocol of its own, rather than among
//               that widget's children: a slot element (`<Paned.StartChild>`,
//               SlotNode) fills a widget-typed property, and a child element
//               (`<Grid.Child column row>`, src/children.ts) places it with
//               parameters of its own.
//
// A WidgetNode holds the widget as a GtkWidget, which is all a parent or the
// window needs. Each subclass also holds it typed as what it is, in its own
// `gtk` field, so its setters are the widget's own methods, with no cast.

import { type GtkApplication, GtkPopover, type GtkWidget, GtkWindow } from "c:Gtk-4.0";
import { g_idle_add_full } from "c:GLib-2.0";

import { connectController, Controllers } from "./controllers.ts";

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
// dispatched while React writes: while props are applied, and while React
// closes, selects or destroys what it rendered (`writeAsReact`).
let reactWriting = 0;

/**
 * Runs `write`, a change React makes to what it rendered beyond its props:
 * closing a dialog, which libadwaita reports as its `close` response, or
 * selecting a tab. No handler hears the signals it causes.
 */
export function writeAsReact(write: () => void): void {
  reactWriting++;
  write();
  reactWriting--;
}

/** Whether a signal now comes from React's own write (`writeAsReact`), not the user. */
export function isReactWriting(): boolean {
  return reactWriting > 0;
}

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

/** Runs `restore` after the flush that follows a user's change: how a controlled value is put back. */
export function scheduleRestore(restore: () => void): void {
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
    if (handler !== null && reactWriting === 0) {
      discreteEvent(handler as () => void);
    }
  }

  /**
   * A signal whose handler says whether it handled it: runs `call`, which asks
   * the handler; with no handler, not handled, so GTK's own default runs.
   */
  decide(call: () => boolean): boolean {
    if (this.handler === null || reactWriting > 0) {
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
    if (reactWriting > 0) {
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

// ---- prop values -----------------------------------------------------------------

/**
 * A prop's value as a list of strings (a widget's `cssClasses`), or null when
 * it is not an array of strings: what a `CStrings` setter takes, checked, as
 * a native build reads anything else out of an erased value.
 */
export function stringsOf(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== "string") {
      return null;
    }
  }
  return value as readonly string[];
}

// ---- a list container's children ----------------------------------------------------

/** Takes `item` out of `items`, if it is there. */
function remove<T>(items: T[], item: T): void {
  const at = items.indexOf(item);
  if (at >= 0) {
    items.splice(at, 1);
  }
}

/** Puts `item` at `index` in `items`, moving what follows up by one. */
export function insertAt<T>(items: T[], index: number, item: T): void {
  items.push(item);
  for (let i = items.length - 1; i > index; i--) {
    items[i] = items[i - 1]!;
  }
  items[index] = item;
}

// ---- the nodes --------------------------------------------------------------------

/**
 * A module of widgets beyond GTK's own that an app opts into (`react-gtk/adw`):
 * it creates the nodes for its host types. A root is given the sets it uses,
 * so an app that uses none links none of their libraries.
 */
export class WidgetSet {
  /** What an app imports it as: `adw`. */
  readonly name: string;
  /** A new node for `type` (`AdwHeaderBar`), or null when the set has no such widget. */
  readonly createNode: (type: string) => HostNode | null;

  constructor(name: string, createNode: (type: string) => HostNode | null) {
    this.name = name;
    this.createNode = createNode;
  }
}

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
   * a widget among its children, a slot element in its slot, a child or group
   * element by its container's protocol. Each kind places itself, so a parent
   * never asks which kind a child is.
   */
  abstract placeIn(parent: WidgetNode, before: HostNode | null): void;
  /** Takes this node back out of `parent`. */
  abstract takeOutOf(parent: WidgetNode): void;

  /** This node as a widget's, or null for a slot, child or group element. */
  abstract widgetNode(): WidgetNode | null;

  /** Whether the node has work for the commit phase once it is placed (`commitMount`). */
  needsCommitMount(): boolean {
    return false;
  }
  /** The node's commit-phase work, after the tree it is in has been placed. */
  commitMount(): void {}

  /** What a ref to the element holds: a widget. */
  abstract publicInstance(): GtkWidget;

  /** The widget GTK shows for this element: its own, or a placed element's child's; null for an empty one. */
  abstract shownWidget(): GtkWidget | null;

  /** Shows or hides what the element shows, as Suspense and Activity do. */
  abstract setVisible(visible: boolean): void;

  /** The JSX name: `Button` for `GtkButton`, `HeaderBar` for `AdwHeaderBar`, without its namespace. */
  name(): string {
    // The namespace is the leading capitalized word: the name starts at the
    // next capital.
    const type = this.type;
    for (let i = 1; i < type.length; i++) {
      const c = type.charAt(i);
      if (c >= "A" && c <= "Z") {
        return type.slice(i);
      }
    }
    return type;
  }
}

/**
 * Where a widget goes when React places it:
 * - Child: among its parent's children, by the parent's protocol;
 * - Toplevel: a window, opened over the window its parent is in;
 * - Attached: a popover, attached to its parent (`set_parent`).
 */
const enum Placement {
  Child,
  Toplevel,
  Attached,
}

function placementOf(widget: GtkWidget): Placement {
  if (widget instanceof GtkWindow) {
    return Placement.Toplevel;
  }
  if (widget instanceof GtkPopover) {
    return Placement.Attached;
  }
  return Placement.Child;
}

/** A widget's node. */
export abstract class WidgetNode extends HostNode {
  readonly widget: GtkWidget;
  private readonly placement: Placement;
  private slots: Map<string, SignalSlot> | null = null;
  // The event controllers input props added (`onKeyPressed`), made on first use.
  private controllers: Controllers | null = null;
  // For a window: the widget, or the root's window, that it was opened from.
  private opener: GtkWidget | null = null;
  // The props last applied: a controlled prop is put back to its value here.
  private props: Props | null = null;
  // The one child a single-child widget holds.
  private only: WidgetNode | null = null;

  constructor(type: string, widget: GtkWidget) {
    super(type);
    this.widget = widget;
    this.placement = placementOf(widget);
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

  shownWidget(): GtkWidget | null {
    return this.widget;
  }

  setVisible(visible: boolean): void {
    this.widget.set_visible(visible);
  }

  widgetNode(): WidgetNode | null {
    return this;
  }

  /** The prop `key` as last applied: a child element reads its container's (a Stack's `visibleChildName`). */
  prop(key: string): unknown {
    return this.props === null ? undefined : this.props[key];
  }
  /** Applies `next`, the props after `previous` (null on creation). */
  applyProps(previous: Props | null, next: Props): void {
    // What is wrong is thrown once the props are applied and dispatch is on
    // again, so a bad prop cannot leave every handler silenced.
    reactWriting++;
    const error = this.applyAll(previous, next);
    this.props = next;
    reactWriting--;
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
      reactWriting++;
      this.setProp(key, wanted);
      reactWriting--;
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
      if (!this.connectSignal(key, slot) && !this.connectController(key, slot)) {
        return null;
      }
      slots.set(key, slot);
    }
    return slot;
  }

  // React's order of this widget's host children, slot and child elements
  // included, made on the first child: where a widget inserted before a slot
  // element goes is before the first widget after it.
  private order: HostNode[] | null = null;

  appendChild(child: HostNode): void {
    const order = this.orderOf();
    remove(order, child);
    order.push(child);
    child.placeIn(this, null);
  }
  insertBefore(child: HostNode, before: HostNode): void {
    const order = this.orderOf();
    remove(order, child);
    const at = order.indexOf(before);
    insertAt(order, at < 0 ? order.length : at, child);
    child.placeIn(this, before);
  }
  removeChild(child: HostNode): void {
    const order = this.order;
    if (order !== null) {
      remove(order, child);
    }
    child.takeOutOf(this);
  }

  private orderOf(): HostNode[] {
    let order = this.order;
    if (order === null) {
      order = [];
      this.order = order;
    }
    return order;
  }

  /** The first widget among this widget's children from `from` on, in React's order; null if none. */
  private widgetFrom(from: HostNode): WidgetNode | null {
    const order = this.order;
    if (order === null) {
      return null;
    }
    for (let i = Math.max(order.indexOf(from), 0); i < order.length; i++) {
      const widget = order[i]!.widgetNode();
      if (widget !== null) {
        return widget;
      }
    }
    return null;
  }

  // A window is a toplevel wherever it is rendered: a dialog a component opens
  // from inside the tree. Placing one records what opened it. It is presented
  // at commit (React places a new tree during render, which can be thrown
  // away, and before that tree is in any window), over the window its opener
  // is in, and destroyed when React takes it out. A popover is attached to
  // the widget it is rendered in, and shown by its `visible` prop.
  /** Whether this is a window, which opens as a toplevel rather than going into its parent. */
  isToplevel(): boolean {
    return this.placement === Placement.Toplevel;
  }
  /** A window, opened from `opener`. */
  openFrom(opener: GtkWidget): void {
    this.opener = opener;
  }
  /** A window, opened as one of `application`'s, over none of its others. */
  joinApplication(application: GtkApplication): void {
    const window = this.widget;
    if (window instanceof GtkWindow) {
      window.set_application(application);
    }
    this.opener = null;
  }
  /** A window, closed. */
  close(): void {
    const window = this.widget instanceof GtkWindow ? this.widget : null;
    if (window !== null) {
      writeAsReact(() => window.destroy());
    }
    this.opener = null;
  }
  needsCommitMount(): boolean {
    return this.isToplevel();
  }
  commitMount(): void {
    const window = this.widget;
    if (!(window instanceof GtkWindow)) {
      return;
    }
    const opener = this.opener;
    const over = opener === null ? null : opener.get_root();
    window.set_transient_for(over instanceof GtkWindow ? over : null);
    window.present();
  }

  // A widget goes among its parent's children, by the parent's protocol.
  placeIn(parent: WidgetNode, before: HostNode | null): void {
    if (this.placement === Placement.Toplevel) {
      this.openFrom(parent.widget);
      return;
    }
    if (this.placement === Placement.Attached) {
      if (this.widget.get_parent() !== parent.widget) {
        this.widget.set_parent(parent.widget);
      }
      return;
    }
    // Before a slot or child element is before the first widget after it.
    const sibling = before === null ? null : parent.widgetFrom(before);
    if (sibling === null) {
      parent.place(this);
    } else {
      parent.placeBefore(this, sibling);
    }
  }
  takeOutOf(parent: WidgetNode): void {
    if (this.placement === Placement.Toplevel) {
      this.close();
      return;
    }
    if (this.placement === Placement.Attached) {
      this.widget.unparent();
      return;
    }
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

  /** Connects an input prop (`onKeyPressed`) through the widget's controllers; false if `key` is none. */
  private connectController(key: string, slot: SignalSlot): boolean {
    let controllers = this.controllers;
    if (controllers === null) {
      controllers = new Controllers();
      this.controllers = controllers;
    }
    return connectController(this.widget, controllers, key, slot);
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
 * An element that holds one widget and places it in the widget it is in, by
 * a protocol of its own: `attach` and `detach`. The child arrives before the
 * element is placed (React completes children first), so it is attached once
 * both are there, and detached when either goes. A change of the element's
 * props detaches and attaches again unless the element can update in place.
 */
export abstract class PlacedNode extends HostNode {
  protected owner: WidgetNode | null = null;
  protected child: WidgetNode | null = null;
  // The element after this one among its owner's children, or null: where a
  // protocol with an order (a Notebook's pages) places it.
  protected before: HostNode | null = null;
  protected props: Props = {};
  private attached = false;

  applyProps(previous: Props | null, next: Props): void {
    const children = next["children"];
    if (typeof children === "string" || typeof children === "number") {
      throw new Error(`<${this.name()}> cannot hold text: put it in a <Label>.`);
    }
    this.props = next;
    const owner = this.owner;
    const child = this.child;
    if (previous !== null && this.attached && owner !== null && child !== null) {
      this.update(owner, child.widget);
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
    this.put();
  }
  insertBefore(child: HostNode, _before: HostNode): void {
    this.appendChild(child);
  }
  removeChild(child: HostNode): void {
    if (this.child === child) {
      this.take();
      this.child = null;
    }
  }

  placeIn(parent: WidgetNode, before: HostNode | null): void {
    // Placed again in its owner, it is moving: in place where the container
    // can move a child, else out first, then in at its new place.
    const child = this.child;
    if (this.attached && this.owner === parent && child !== null) {
      this.before = before;
      if (this.move(parent, child.widget)) {
        return;
      }
    }
    this.take();
    this.owner = parent;
    this.before = before;
    this.put();
  }
  takeOutOf(parent: WidgetNode): void {
    if (this.owner === parent) {
      this.take();
      this.owner = null;
    }
  }

  private put(): void {
    const owner = this.owner;
    const child = this.child;
    if (!this.attached && owner !== null && child !== null) {
      this.attach(owner, child.widget);
      this.attached = true;
    }
  }
  private take(): void {
    const owner = this.owner;
    const child = this.child;
    if (this.attached && owner !== null && child !== null) {
      this.attached = false;
      this.detach(owner, child.widget);
    }
  }

  /** Puts `widget` in `owner`. */
  protected abstract attach(owner: WidgetNode, widget: GtkWidget): void;
  /** Takes `widget` back out of `owner`. */
  protected abstract detach(owner: WidgetNode, widget: GtkWidget): void;
  /**
   * Moves `widget`, already in `owner`, to its new place (`before`), keeping
   * whatever `owner` holds for it (a selected page stays selected); false
   * where the container cannot, and the element is taken out and put back.
   */
  protected move(_owner: WidgetNode, _widget: GtkWidget): boolean {
    return false;
  }
  /** The element's props changed while its child is in `owner`. */
  protected update(owner: WidgetNode, widget: GtkWidget): void {
    this.detach(owner, widget);
    this.attach(owner, widget);
  }

  widgetNode(): WidgetNode | null {
    return null;
  }

  shownWidget(): GtkWidget | null {
    const child = this.child;
    return child === null ? null : child.widget;
  }

  publicInstance(): GtkWidget {
    const widget = this.shownWidget();
    if (widget === null) {
      throw new Error(`<${this.name()}> is empty: a ref to it has no widget.`);
    }
    return widget;
  }

  setVisible(visible: boolean): void {
    const child = this.child;
    if (child !== null) {
      child.setVisible(visible);
    }
  }
}

/**
 * A slot element, `<Paned.StartChild>`: its child fills the widget slot its
 * host type names, in the widget the element is in. Where it sits among that
 * widget's children is no place in GTK.
 */
export class SlotNode extends PlacedNode {
  protected attach(owner: WidgetNode, widget: GtkWidget): void {
    if (!owner.fillSlot(this.type, widget)) {
      throw new Error(`<${owner.name()}> has no slot <${this.name()}>.`);
    }
  }
  protected detach(owner: WidgetNode, _widget: GtkWidget): void {
    owner.fillSlot(this.type, null);
  }
}
