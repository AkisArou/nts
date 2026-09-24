// Scenarios the native build must agree with node on. Each exported function
// renders through our react, reconciler and production scheduler into the
// typed test host and returns the serialised host tree after each step.

import { createElement, useEffect, useState } from "react";
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
