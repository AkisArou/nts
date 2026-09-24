import { isDevelopment } from "shared/Build.ts";
import { getOwnerStackByFiberInDev } from "./ReactFiberComponentStack.ts";
import type { Fiber } from "./ReactInternalTypes.ts";
import { ReactSharedInternals } from "./ReactSharedInternals.ts";
import { getComponentNameFromOwner } from "./getComponentNameFromFiber.ts";

export let current: Fiber | null = null;
export let isRendering: boolean = false;

// `console.createTask`'s task, which runs a callback with an async stack.
interface ConsoleTask {
  run<T>(callback: () => T): T;
}

export function getCurrentFiberOwnerNameInDevOrNull(): string | null {
  if (isDevelopment) {
    if (current === null) {
      return null;
    }
    const owner = current._debugOwner;
    if (owner != null) {
      return getComponentNameFromOwner(owner);
    }
  }
  return null;
}

function getCurrentFiberStackInDev(): string {
  if (isDevelopment) {
    if (current === null) {
      return "";
    }
    // Safe because if current fiber exists, we are reconciling,
    // and it is guaranteed to be the work-in-progress version.
    // TODO: The above comment is not actually true. We might be
    // in a commit phase or preemptive set state callback.
    return getOwnerStackByFiberInDev(current);
  }
  return "";
}

// Runs `callback` with `fiber` as the current fiber, so warnings raised
// inside it carry its component stack. Development only.
export function runWithFiberInDEV<Args extends unknown[], T>(
  fiber: Fiber | null,
  callback: (...args: Args) => T,
  ...args: Args
): T {
  if (isDevelopment) {
    const previousFiber = current;
    setCurrentFiber(fiber);
    try {
      if (fiber !== null && fiber._debugTask) {
        return (fiber._debugTask as ConsoleTask).run(() => callback(...args));
      }
      return callback(...args);
    } finally {
      setCurrentFiber(previousFiber);
    }
  }
  // These errors should never make it into a build so we don't need to encode them in codes.json
  throw new Error("runWithFiberInDEV should never be called in production. This is a bug in React.");
}

export function resetCurrentFiber(): void {
  if (isDevelopment) {
    ReactSharedInternals.getCurrentStack = null;
    isRendering = false;
  }
  current = null;
}

export function setCurrentFiber(fiber: Fiber | null): void {
  if (isDevelopment) {
    ReactSharedInternals.getCurrentStack = fiber === null ? null : getCurrentFiberStackInDev;
    isRendering = false;
  }
  current = fiber;
}

export function setIsRendering(rendering: boolean): void {
  if (isDevelopment) {
    isRendering = rendering;
  }
}

export function getIsRendering(): boolean | undefined {
  if (isDevelopment) {
    return isRendering;
  }
  return undefined;
}
