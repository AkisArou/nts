import type { RootState } from "./ReactFiberRoot.ts";
import type { FiberRoot } from "./ReactInternalTypes.ts";

// This is imported by the event replaying implementation in React DOM. It's
// in a separate file to break a circular dependency between the renderer and
// the reconciler.
export function isRootDehydrated(root: FiberRoot): boolean {
  const currentState = root.current.memoizedState as RootState;
  return currentState.isDehydrated;
}
