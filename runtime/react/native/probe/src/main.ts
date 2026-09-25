// Scenarios the native build must agree with node on. Each exported function
// renders through our react, reconciler and production scheduler into the
// typed test host and returns the serialised host tree after each step.

import { Component, createElement, PureComponent, useEffect, useRef, useState } from "react";
import type { ReactElement } from "shared/ReactTypes.ts";
import { createContainer, updateContainer } from "react-reconciler/ReactFiberReconciler.ts";
import { ConcurrentRoot } from "react-reconciler/ReactRootTags.ts";
import type * as Contract from "react-reconciler/ReactFiberConfig.ts";
import type * as TestHost from "./ReactFiberConfig.ts";
import { TestContainer } from "./ReactFiberConfig.ts";
import { drainHost } from "./SchedulerHost.ts";

// The test host must supply every name the contract declares.
type MissingFrom<Config> = Exclude<keyof typeof Contract, keyof Config>;
export const testHostIsComplete: [MissingFrom<typeof TestHost>] extends [never] ? true : MissingFrom<typeof TestHost> = true;

function ignoreError(): void {}

function mount(container: TestContainer) {
  return createContainer(container, ConcurrentRoot, null, false, false, "", ignoreError, ignoreError, ignoreError, () => {}, null);
}

type ItemsProps = { [key: string]: unknown };

function Item(props: ItemsProps): ReactElement {
  const label = props["label"];
  const text = typeof label === "string" ? label : "";
  return createElement("li", { label: text }, "item " + text);
}

// Keyed reconciliation: the same items in a new order must move, not
// remount.
export function keyedReorder(count: number): string {
  const n = count < 1 ? 1 : count > 12 ? 12 : Math.floor(count);
  const container = new TestContainer();
  const root = mount(container);
  const labels: string[] = [];
  for (let i = 0; i < n; i++) {
    labels.push("k" + i);
  }
  // One array child: a keyed list, exactly as a spread of the same elements.
  const render = (order: string[]) =>
    createElement("ul", null, order.map((label) => createElement(Item, { key: label, label })));
  updateContainer(render(labels), root, null, null);
  drainHost();
  const first = container.serialize();
  updateContainer(render(labels.slice().reverse()), root, null, null);
  drainHost();
  return first + " | " + container.serialize();
}

// State and effects: an effect sets state once after mount.
export function stateAfterEffect(start: number): string {
  const container = new TestContainer();
  const root = mount(container);
  function Counter(_props: ItemsProps): ReactElement {
    const [count, setCount] = useState(start);
    useEffect(() => {
      if (count === start) {
        setCount(count + 1);
      }
    }, [count]);
    return createElement("span", null, "count " + count);
  }
  updateContainer(createElement(Counter, null), root, null, null);
  drainHost();
  return container.serialize();
}

// A component that changes the order of its hooks between renders. Upstream
// React reads one hook's state as another's; this runtime's native build
// checks each hook's kind and throws, which the root reports.
export function changedHookOrder(start: number): string {
  let reported = "none";
  const container = new TestContainer();
  const root = createContainer(container, ConcurrentRoot, null, false, false, "", (error: unknown) => {
    reported = String(error);
  }, ignoreError, ignoreError, () => {}, null);
  function Swapping(props: ItemsProps): ReactElement {
    if (props["flipped"] === true) {
      useRef(start);
      const [n] = useState(start);
      return createElement("span", null, "n " + n);
    }
    const [n] = useState(start);
    useRef(start);
    return createElement("span", null, "n " + n);
  }
  updateContainer(createElement(Swapping, { flipped: false }), root, null, null);
  drainHost();
  const first = container.serialize();
  updateContainer(createElement(Swapping, { flipped: true }), root, null, null);
  drainHost();
  return first + " | " + container.serialize() + " | " + reported;
}


// ---- class components ---------------------------------------------------------

type Note = (line: string) => void;
type TickerProps = { start: number; note: Note };
type TickerState = { count: number; label: string };

class Ticker extends Component<TickerProps, TickerState> {
  // `label` is set once: setState({ count }) must keep it.
  state: TickerState = { count: this.props.start, label: "t" + this.props.start };

  componentDidMount(): void {
    this.props.note("mount " + this.state.count);
    if (this.state.count === this.props.start) {
      this.setState({ count: this.state.count + 1 });
    }
  }

  componentDidUpdate(_prevProps: TickerProps, prevState: TickerState): void {
    this.props.note("update " + prevState.count + ">" + this.state.count);
  }

  componentWillUnmount(): void {
    this.props.note("unmount " + this.state.count);
  }

  render(): ReactElement {
    return createElement("span", null, "count " + this.state.count + " " + this.state.label);
  }
}

// A class's lifecycles, in order: mount, a state update from mount, a props
// update, unmount.
export function classLifecycles(start: number): string {
  const lines: string[] = [];
  const note: Note = (line) => {
    lines.push(line);
  };
  const container = new TestContainer();
  const root = mount(container);
  updateContainer(createElement(Ticker, { start, note }), root, null, null);
  drainHost();
  const mounted = container.serialize();
  updateContainer(createElement(Ticker, { start: start + 10, note }), root, null, null);
  drainHost();
  updateContainer(null, root, null, null);
  drainHost();
  return mounted + " | " + lines.join(", ");
}

type BoundaryProps = { note: Note; children?: unknown };
type BoundaryState = { error: string | null };

class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown): void {
    this.props.note("caught " + (error instanceof Error ? error.message : String(error)));
  }

  render(): unknown {
    return this.state.error !== null ? createElement("span", null, "fallback " + this.state.error) : this.props.children;
  }
}

function Thrower(props: { n: number }): ReactElement {
  if (props.n % 2 === 1) {
    throw new Error("odd " + props.n);
  }
  return createElement("span", null, "ok " + props.n);
}

// An error boundary: an odd input throws in render, and the boundary shows
// its fallback and hears of the error; an even one renders.
export function errorBoundary(n: number): string {
  const lines: string[] = [];
  const note: Note = (line) => {
    lines.push(line);
  };
  const container = new TestContainer();
  const root = mount(container);
  updateContainer(createElement(Boundary, { note }, createElement(Thrower, { n })), root, null, null);
  drainHost();
  return container.serialize() + " | " + (lines.length === 0 ? "none" : lines.join(", "));
}

class Pure extends PureComponent<{ label: string; note: Note }> {
  render(): ReactElement {
    this.props.note("render " + this.props.label);
    return createElement("span", null, this.props.label);
  }
}

// A PureComponent re-rendered with equal props does not render again; with
// a changed label it does.
export function pureSkip(changes: number): string {
  const lines: string[] = [];
  const note: Note = (line) => {
    lines.push(line);
  };
  const container = new TestContainer();
  const root = mount(container);
  for (let i = 0; i <= 2; i++) {
    const label = "v" + Math.min(i, changes);
    updateContainer(createElement(Pure, { label, note }), root, null, null);
    drainHost();
  }
  return container.serialize() + " | " + lines.join(", ");
}
