import { isDevelopment } from "shared/Build.ts";
import { reportGlobalError } from "shared/reportGlobalError.ts";
import type { CapturedValue } from "./ReactCapturedValue.ts";
import { bindToConsole } from "react-reconciler/ReactFiberConfig.ts";
import type { ErrorInfo, Fiber, FiberRoot } from "./ReactInternalTypes.ts";
import { ReactSharedInternals } from "./ReactSharedInternals.ts";
import { ClassComponent } from "./ReactWorkTags.ts";
import { getComponentNameFromFiber } from "./getComponentNameFromFiber.ts";

// Side-channel since I'm not sure we want to make this part of the public API
let componentName: string | null = null;
let errorBoundaryName: string | null = null;

export function defaultOnUncaughtError(error: unknown, _errorInfo: ErrorInfo): void {
  // Overriding this can silence these warnings e.g. for tests.
  // See https://github.com/facebook/react/pull/13384

  // For uncaught root errors we report them as uncaught to the browser's
  // onerror callback. This won't have component stacks and the error addendum.
  // So we add those into a separate console.warn.
  reportGlobalError(error);
  if (isDevelopment) {
    const componentNameMessage = componentName
      ? `An error occurred in the <${componentName}> component.`
      : "An error occurred in one of your React components.";

    const errorBoundaryMessage =
      "Consider adding an error boundary to your tree to customize error handling behavior.\n" +
      "Visit https://react.dev/link/error-boundaries to learn more about error boundaries.";

    try {
      console.warn(
        "%s\n\n%s\n",
        componentNameMessage,
        errorBoundaryMessage,
        // We let our console.error wrapper add the component stack to the end.
      );
    } finally {
      // ignore
    }
  }
}

export function defaultOnCaughtError(error: unknown, _errorInfo: ErrorInfo): void {
  // Overriding this can silence these warnings e.g. for tests.
  // See https://github.com/facebook/react/pull/13384

  // Caught by error boundary
  if (isDevelopment) {
    const componentNameMessage = componentName
      ? `The above error occurred in the <${componentName}> component.`
      : "The above error occurred in one of your React components.";

    // In development, we provide our own message which includes the component stack
    // in addition to the error.
    const recreateMessage =
      `React will try to recreate this component tree from scratch ` +
      `using the error boundary you provided, ${errorBoundaryName || "Anonymous"}.`;

    try {
      const environmentName =
        typeof error === "object" && error !== null ? (error as { environmentName?: unknown }).environmentName : undefined;
      if (typeof environmentName === "string") {
        // This was a Server error. We print the environment name in a badge just like we do with
        // replays of console logs to indicate that the source of this throw as actually the Server.
        bindToConsole(
          "error",
          [
            "%o\n\n%s\n\n%s\n",
            error,
            componentNameMessage,
            recreateMessage,
            // We let DevTools or console.createTask add the component stack to the end.
          ],
          environmentName,
        )();
      } else {
        console.error(
          "%o\n\n%s\n\n%s\n",
          error,
          componentNameMessage,
          recreateMessage,
          // We let our DevTools or console.createTask add the component stack to the end.
        );
      }
    } finally {
      // ignore
    }
  } else {
    // In production, we print the error directly.
    // This will include the message, the JS stack, and anything the browser wants to show.
    // We pass the error object instead of custom message so that the browser displays the error natively.
    console["error"](error); // Don't transform to our wrapper, however, React DevTools can still add a stack.
  }
}

export function defaultOnRecoverableError(error: unknown, _errorInfo: ErrorInfo): void {
  reportGlobalError(error);
}

export function logUncaughtError(root: FiberRoot, errorInfo: CapturedValue<unknown>): void {
  try {
    if (isDevelopment) {
      componentName = errorInfo.source ? getComponentNameFromFiber(errorInfo.source) : null;
      errorBoundaryName = null;
    }
    const error = errorInfo.value;
    if (isDevelopment && ReactSharedInternals.actQueue !== null) {
      // For uncaught errors inside act, we track them on the act and then
      // rethrow them into the test.
      ReactSharedInternals.thrownErrors.push(error);
      return;
    }
    const onUncaughtError = root.onUncaughtError;
    onUncaughtError(error, {
      componentStack: errorInfo.stack,
    });
  } catch (e) {
    // This method must not throw, or React internal state will get messed up.
    // If console.error is overridden, or logCapturedError() shows a dialog that throws,
    // we want to report this error outside of the normal stack as a last resort.
    // https://github.com/facebook/react/issues/13188
    setTimeout(() => {
      throw e;
    });
  }
}

export function logCaughtError(root: FiberRoot, boundary: Fiber, errorInfo: CapturedValue<unknown>): void {
  try {
    if (isDevelopment) {
      componentName = errorInfo.source ? getComponentNameFromFiber(errorInfo.source) : null;
      errorBoundaryName = getComponentNameFromFiber(boundary);
    }
    const error = errorInfo.value;
    const onCaughtError = root.onCaughtError;
    onCaughtError(error, {
      componentStack: errorInfo.stack,
      errorBoundary:
        boundary.tag === ClassComponent
          ? boundary.stateNode // This should always be the case as long as we only have class boundaries
          : null,
    });
  } catch (e) {
    // This method must not throw, or React internal state will get messed up.
    // If console.error is overridden, or logCapturedError() shows a dialog that throws,
    // we want to report this error outside of the normal stack as a last resort.
    // https://github.com/facebook/react/issues/13188
    setTimeout(() => {
      throw e;
    });
  }
}
