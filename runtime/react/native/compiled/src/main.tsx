// The native probe's scenarios, written as an app writes them: components in
// TSX, which the React Compiler memoizes before nts compiles them. Each
// exported function renders into the typed test host and returns the
// serialised host tree after each step, as the probe's do.

import { useEffect, useRef, useState } from "react";
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

