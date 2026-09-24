import { isDevelopment } from "shared/Build.ts";
import { noop } from "shared/noop.ts";
import { reportGlobalError } from "shared/reportGlobalError.ts";
import type { StartTransitionOptions, Transition } from "shared/ReactTypes.ts";
import { ReactSharedInternals } from "./ReactSharedInternals.ts";

function releaseAsyncTransition(): void {
  if (isDevelopment) {
    ReactSharedInternals.asyncTransitions--;
  }
}

// Marks the updates `scope` schedules as a transition: they render at a
// lower priority and can be interrupted. An async scope keeps the transition
// open until its promise settles (the renderer tracks that through `S`).
export function startTransition(scope: () => unknown, _options?: StartTransitionOptions): void {
  const prevTransition = ReactSharedInternals.T;
  const currentTransition: Transition = {
    // A nested transition shares its parent's set of types.
    types: prevTransition !== null ? prevTransition.types : null,
    gesture: null,
    name: null,
    startTime: -1,
  };
  if (isDevelopment) {
    currentTransition._updatedFibers = new Set<unknown>();
  }
  ReactSharedInternals.T = currentTransition;
  try {
    const returnValue = scope();
    const onStartTransitionFinish = ReactSharedInternals.S;
    if (onStartTransitionFinish !== null) {
      onStartTransitionFinish(currentTransition, returnValue);
    }
    if (
      typeof returnValue === "object" &&
      returnValue !== null &&
      typeof (returnValue as { then?: unknown }).then === "function"
    ) {
      const thenable = returnValue as PromiseLike<unknown>;
      if (isDevelopment) {
        // Keep track of async transitions for a warning about
        // addTransitionType called in the gap.
        ReactSharedInternals.asyncTransitions++;
        thenable.then(releaseAsyncTransition, releaseAsyncTransition);
      }
      thenable.then(noop, reportGlobalError);
    }
  } catch (error) {
    reportGlobalError(error);
  } finally {
    warnAboutTransitionSubscriptions(prevTransition, currentTransition);
    if (prevTransition !== null && currentTransition.types !== null) {
      // An inner transition may have created the types set; hand it back.
      if (
        isDevelopment &&
        prevTransition.types !== null &&
        prevTransition.types !== currentTransition.types
      ) {
        console.error(
          "We expected inner Transitions to have transferred the outer types set and " +
            "that you cannot add to the outer Transition while inside the inner." +
            "This is a bug in React.",
        );
      }
      prevTransition.types = currentTransition.types;
    }
    ReactSharedInternals.T = prevTransition;
  }
}

function warnAboutTransitionSubscriptions(prevTransition: Transition | null, currentTransition: Transition): void {
  if (isDevelopment && prevTransition === null && currentTransition._updatedFibers !== undefined) {
    const updatedFibersCount = currentTransition._updatedFibers.size;
    currentTransition._updatedFibers.clear();
    if (updatedFibersCount > 10) {
      console.warn(
        "Detected a large number of updates inside startTransition. " +
          "If this is due to a subscription please re-write it to use React provided hooks. " +
          "Otherwise concurrent mode guarantees are off the table.",
      );
    }
  }
}
