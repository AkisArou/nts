// The native probe's scenarios, written as an app writes them: components in
// TSX, which the React Compiler memoizes before nts compiles them. Each
// exported function renders into the typed test host and returns the
// serialised host tree after each step, as the probe's do.

import { Component, PureComponent, useEffect, useRef, useState } from "react";
import { createContainer, updateContainer } from "react-reconciler/ReactFiberReconciler.ts";
import { ConcurrentRoot } from "react-reconciler/ReactRootTags.ts";
import { TestContainer } from "./ReactFiberConfig.ts";
import { drainHost } from "./SchedulerHost.ts";

function ignoreError(): void {}

function mount(container: TestContainer) {
  return createContainer(container, ConcurrentRoot, null, false, false, "", ignoreError, ignoreError, ignoreError, () => {}, null);
}

function Item({ label }: { label: string }) {
  return <li label={label}>item {label}</li>;
}

function List({ order }: { order: string[] }) {
  return (
    <ul>
      {order.map((label) => (
        <Item key={label} label={label} />
      ))}
    </ul>
  );
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
  updateContainer(<List order={labels} />, root, null, null);
  drainHost();
  const first = container.serialize();
  updateContainer(<List order={labels.slice().reverse()} />, root, null, null);
  drainHost();
  return first + " | " + container.serialize();
}

function Counter({ start }: { start: number }) {
  const [count, setCount] = useState(start);
  useEffect(() => {
    if (count === start) {
      setCount(count + 1);
    }
  }, [count, start]);
  return <span>count {count}</span>;
}

// State and effects: an effect sets state once after mount.
export function stateAfterEffect(start: number): string {
  const container = new TestContainer();
  const root = mount(container);
  updateContainer(<Counter start={start} />, root, null, null);
  drainHost();
  return container.serialize();
}

function Swapping({ flipped, start }: { flipped: boolean; start: number }) {
  if (flipped) {
    useRef(start);
    const [n] = useState(start);
    return <span>n {n}</span>;
  }
  const [n] = useState(start);
  useRef(start);
  return <span>n {n}</span>;
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
  updateContainer(<Swapping flipped={false} start={start} />, root, null, null);
  drainHost();
  const first = container.serialize();
  updateContainer(<Swapping flipped={true} start={start} />, root, null, null);
  drainHost();
  return first + " | " + container.serialize() + " | " + reported;
}


// ---- class components ---------------------------------------------------------

type Note = (line: string) => void;
type TickerProps = { start: number; note: Note };
type TickerState = { count: number };

class Ticker extends Component<TickerProps, TickerState> {
  state: TickerState = { count: this.props.start };

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

  render() {
    return <span>count {this.state.count}</span>;
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
  updateContainer(<Ticker start={start} note={note} />, root, null, null);
  drainHost();
  const mounted = container.serialize();
  updateContainer(<Ticker start={start + 10} note={note} />, root, null, null);
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

  render() {
    return this.state.error !== null ? <span>fallback {this.state.error}</span> : this.props.children;
  }
}

function Thrower({ n }: { n: number }) {
  if (n % 2 === 1) {
    throw new Error("odd " + n);
  }
  return <span>ok {n}</span>;
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
  updateContainer(
    <Boundary note={note}>
      <Thrower n={n} />
    </Boundary>,
    root,
    null,
    null,
  );
  drainHost();
  return container.serialize() + " | " + (lines.length === 0 ? "none" : lines.join(", "));
}

class Pure extends PureComponent<{ label: string; note: Note }> {
  render() {
    this.props.note("render " + this.props.label);
    return <span>{this.props.label}</span>;
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
    updateContainer(<Pure label={"v" + Math.min(i, changes)} note={note} />, root, null, null);
    drainHost();
  }
  return container.serialize() + " | " + lines.join(", ");
}
