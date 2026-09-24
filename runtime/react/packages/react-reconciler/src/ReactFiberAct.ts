import { isDevelopment } from "shared/Build.ts";
import type { Fiber } from "./ReactInternalTypes.ts";
import { ReactSharedInternals } from "./ReactSharedInternals.ts";
import { warnsIfNotActing } from "react-reconciler/ReactFiberConfig.ts";

// The globals a test environment sets to say it wraps updates in `act`.
interface ActEnvironmentGlobals {
  IS_REACT_ACT_ENVIRONMENT?: unknown;
  jest?: unknown;
}

function actEnvironmentGlobal(): unknown {
  return (globalThis as ActEnvironmentGlobals).IS_REACT_ACT_ENVIRONMENT;
}

export function isLegacyActEnvironment(_fiber: Fiber): boolean {
  if (isDevelopment) {
    // Legacy mode. We preserve the behavior of React 17's act. It assumes an
    // act environment whenever `jest` is defined, but you can still turn off
    // spurious warnings by setting IS_REACT_ACT_ENVIRONMENT explicitly
    // to false.
    const isReactActEnvironmentGlobal = actEnvironmentGlobal();
    const jestIsDefined = typeof (globalThis as ActEnvironmentGlobals).jest !== "undefined";
    return warnsIfNotActing && jestIsDefined && isReactActEnvironmentGlobal !== false;
  }
  return false;
}

export function isConcurrentActEnvironment(): unknown {
  if (isDevelopment) {
    const isReactActEnvironmentGlobal = actEnvironmentGlobal();
    if (!isReactActEnvironmentGlobal && ReactSharedInternals.actQueue !== null) {
      // TODO: Include link to relevant documentation page.
      console.error("The current testing environment is not configured to support " + "act(...)");
    }
    return isReactActEnvironmentGlobal;
  }
  return false;
}
