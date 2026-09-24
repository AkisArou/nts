// The native twin of react-reconciler's ReactFiberHooksDispatcher.ts. There
// are no dispatcher objects: installing a dispatcher records which phase is
// rendering, and `react`'s hooks (ReactHooks.ts beside this file) switch on
// it and call the reconciler's implementation directly. Every hook call is a
// direct, monomorphised call.

import { updateState } from "react-reconciler/ReactFiberHooks.ts";
import type { BasicStateAction, Dispatch } from "shared/ReactTypes.ts";

export type HookDispatcherKind = number;

export const ContextOnlyKind = 0;
export const MountKind = 1;
export const UpdateKind = 2;
export const RerenderKind = 3;
export const MountInDEVKind = 4;
export const MountWithHookTypesInDEVKind = 5;
export const UpdateInDEVKind = 6;
export const RerenderInDEVKind = 7;
export const InvalidNestedMountInDEVKind = 8;
export const InvalidNestedUpdateInDEVKind = 9;
export const InvalidNestedRerenderInDEVKind = 10;

// No dispatcher installed: outside any render.
export const NoDispatcher = -1;

// What saveDispatcher returns: the recorded phase.
export type SavedDispatcher = number;

class InstalledDispatcher {
  kind: number = NoDispatcher;
}

const installed = new InstalledDispatcher();

export function currentDispatcherKind(): number {
  return installed.kind;
}

export function installDispatcher(kind: HookDispatcherKind): void {
  installed.kind = kind;
}

export function saveDispatcher(): SavedDispatcher {
  return installed.kind;
}

export function restoreDispatcher(saved: SavedDispatcher): void {
  installed.kind = saved;
}

export function pushContextOnlyDispatcher(): SavedDispatcher {
  const previous = installed.kind;
  installed.kind = ContextOnlyKind;
  return previous === NoDispatcher ? ContextOnlyKind : previous;
}

// Only the host transition component calls this, and it always renders as an
// update; the development dispatchers are not part of a native build.
export function useStateThroughDispatcher<S>(initialState: (() => S) | S): [S, Dispatch<BasicStateAction<S>>] {
  return updateState(initialState);
}
