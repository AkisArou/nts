import { enableDefaultTransitionIndicator, enableViewTransition } from "shared/ReactFeatureFlags.ts";

export let rootMutationContext: boolean = false;
export let viewTransitionMutationContext: boolean = false;

export function pushRootMutationContext(): void {
  if (enableDefaultTransitionIndicator) {
    rootMutationContext = false;
  }
  if (enableViewTransition) {
    viewTransitionMutationContext = false;
  }
}

export function pushMutationContext(): boolean {
  if (!enableViewTransition) {
    return false;
  }
  const prev = viewTransitionMutationContext;
  viewTransitionMutationContext = false;
  return prev;
}

export function popMutationContext(prev: boolean): void {
  if (enableViewTransition) {
    if (viewTransitionMutationContext) {
      rootMutationContext = true;
    }
    viewTransitionMutationContext = prev;
  }
}

export function trackHostMutation(): void {
  // This is extremely hot function that must be inlined. Don't add more stuff.
  if (enableViewTransition) {
    viewTransitionMutationContext = true;
  } else if (enableDefaultTransitionIndicator) {
    // We only set this if enableViewTransition is not on. Otherwise we track
    // it on the viewTransitionMutationContext and collect it when we pop
    // to avoid more than a single operation in this hot path.
    rootMutationContext = true;
  }
}
