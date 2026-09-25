import type { CapturedValue } from "react-reconciler/ReactCapturedValue.ts";
import type { ActivityInstance } from "react-reconciler/ReactFiberConfig.ts";
import type { Lane } from "./ReactFiberLane.ts";
import type { TreeContext } from "./ReactFiberTreeContext.ts";

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
