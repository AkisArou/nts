import type { CapturedValue } from "react-reconciler/ReactCapturedValue.ts";
import type { ActivityInstance } from "react-reconciler/ReactFiberConfig.ts";
import type { Lane } from "./ReactFiberLane.ts";
import type { TreeContext } from "./ReactFiberTreeContext.ts";
import { propOf } from "./ReactFiberProps.ts";

// A non-null ActivityState represents a dehydrated Activity boundary.
export interface ActivityState {
  dehydrated: ActivityInstance;
  treeContext: TreeContext | null;
  // Represents the lane we should attempt to hydrate a dehydrated boundary at.
  // OffscreenLane is the default for dehydrated boundaries.
  // NoLane is the default for normal boundaries, which turns into "normal" pri.
  retryLane: Lane;
  // Stashed Errors that happened while attempting to hydrate this boundary.
  hydrationErrors: CapturedValue[] | null;
}

export interface ActivityProps {
  mode?: "hidden" | "visible" | null | undefined;
  children?: unknown;
  name?: string;
}

// A ActivityProps field of the record, its key checked against the interface.
function activityField(props: unknown, key: keyof ActivityProps): unknown {
  return propOf(props, key);
}

/** The ActivityProps a fiber holds as a record, read into its declared shape (ReactFiberProps.ts). */
export function activityPropsOf(props: unknown): ActivityProps {
  return {
    mode: activityField(props, "mode") as ActivityProps["mode"],
    children: activityField(props, "children") as ActivityProps["children"],
    name: activityField(props, "name") as ActivityProps["name"],
  };
}
