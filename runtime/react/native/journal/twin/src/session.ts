// A session of the libadwaita Journal, as a user plays it: write an entry and
// save it with the button, write another and save it with Enter, press Enter
// on nothing, switch to the entries, delete the first. After each step the
// twin logs what the app shows, read from the props React committed: the
// page, the toggles' labels, the draft, the rows, whether the empty page
// shows, and how many toasts. The native Journal logs the same facts read
// from its widgets. The component comes as an argument, so this module
// imports nothing of react-gtk: it is checked, and runs, on the test host.

import { createElement } from "react";
import type { ReactElement } from "shared/ReactTypes.ts";
import { createContainer, updateContainer } from "react-reconciler/ReactFiberReconciler.ts";
import { ConcurrentRoot } from "react-reconciler/ReactRootTags.ts";
import { TestContainer, TestInstance, type TestNode } from "./ReactFiberConfig.ts";
import { drainHost } from "./SchedulerHost.ts";

function reportError(error: unknown): void {
  console.log("error " + (error instanceof Error ? error.message : "a non-error"));
}

/** Every committed instance of host type `type`, in tree order. */
function instances(nodes: readonly TestNode[], type: string, into: TestInstance[] = []): TestInstance[] {
  for (const node of nodes) {
    if (node instanceof TestInstance) {
      if (node.type === type) {
        into.push(node);
      }
      instances(node.children, type, into);
    }
  }
  return into;
}

function only(container: TestContainer, type: string): TestInstance {
  const found = instances(container.children, type);
  if (found.length !== 1) {
    throw new Error(`${found.length} <${type}> committed, not one`);
  }
  return found[0]!;
}

function text(node: TestInstance, key: string): string {
  const value = node.props[key];
  return typeof value === "string" ? value : "";
}

/** The handler `key` of `node`, as the widget's signal would run it. */
function handler(node: TestInstance, key: string): unknown {
  const value = node.props[key];
  if (typeof value !== "function") {
    throw new Error(`<${node.type}> has no ${key}`);
  }
  return value;
}

function facts(container: TestContainer): string {
  const toggles = instances(container.children, "AdwToggleGroup.Toggle").map((toggle) => text(toggle, "label"));
  const rows = instances(container.children, "AdwActionRow").map((row) => text(row, "title"));
  return [
    "page=" + text(only(container, "AdwViewStack"), "visibleChildName"),
    "toggles=" + toggles.join(","),
    "draft=" + text(only(container, "AdwEntryRow"), "text"),
    "rows=" + rows.join(","),
    "empty=" + String(instances(container.children, "AdwStatusPage").length === 1),
    "toasts=" + String(instances(container.children, "AdwToastOverlay.Toast").length),
  ].join(" ");
}

/** Plays the session on `Journal`, logging the facts after each step. */
export function playSession(Journal: () => ReactElement): void {
  const container = new TestContainer();
  const root = createContainer(container, ConcurrentRoot, null, false, false, "", reportError, reportError, reportError, () => {}, null);
  const step = (name: string, act: () => void): void => {
    act();
    drainHost();
    console.log(name + " " + facts(container));
  };
  step("mount", () => updateContainer(createElement(Journal, null), root, null, null));
  const type = (value: string): void => (handler(only(container, "AdwEntryRow"), "onNotifyText") as (value: string) => void)(value);
  step("type", () => type("first"));
  step("save", () => (handler(only(container, "AdwButtonRow"), "onActivated") as () => void)());
  step("type", () => type("second"));
  step("enter", () => (handler(only(container, "AdwEntryRow"), "onEntryActivated") as () => void)());
  step("enter-empty", () => (handler(only(container, "AdwEntryRow"), "onEntryActivated") as () => void)());
  step("read", () => (handler(only(container, "AdwToggleGroup"), "onNotifyActiveName") as (name: string | null) => void)("read"));
  step("delete", () => (handler(instances(container.children, "GtkButton")[0]!, "onClicked") as () => void)());
  step("write", () => (handler(only(container, "AdwToggleGroup"), "onNotifyActiveName") as (name: string | null) => void)(null));
}
