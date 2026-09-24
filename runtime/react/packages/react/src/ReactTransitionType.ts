import { isDevelopment } from "shared/Build.ts";
import { ReactSharedInternals } from "./ReactSharedInternals.ts";
import { startTransition } from "./ReactStartTransition.ts";

// Tags the current transition, for `<ViewTransition>` to choose an
// animation by.
export function addTransitionType(type: string): void {
  const transition = ReactSharedInternals.T;
  if (transition !== null) {
    const transitionTypes = transition.types;
    if (transitionTypes === null) {
      transition.types = [type];
    } else if (transitionTypes.indexOf(type) === -1) {
      transitionTypes.push(type);
    }
    return;
  }
  // In the gap of an async transition: act as an implicit startTransition.
  if (isDevelopment && ReactSharedInternals.asyncTransitions === 0) {
    console.error(
      "addTransitionType can only be called inside a `startTransition()` " +
        "callback. It must be associated with a specific Transition.",
    );
  }
  startTransition(() => addTransitionType(type));
}
