import { isDevelopment } from "shared/Build.ts";
import { checkKeyStringCoercion } from "shared/CheckStringCoercion.ts";
import { REACT_PORTAL_TYPE } from "shared/ReactSymbols.ts";
import type { ReactPortal } from "shared/ReactTypes.ts";

export function createPortal(
  children: unknown,
  containerInfo: unknown,
  // TODO: figure out the API for cross-renderer implementation.
  implementation: unknown,
  key: string | null | undefined = null,
): ReactPortal {
  let resolvedKey: string | null;
  if (key == null) {
    resolvedKey = null;
  } else {
    if (isDevelopment) {
      checkKeyStringCoercion(key);
    }
    resolvedKey = "" + key;
  }
  return {
    // This tag allow us to uniquely identify this as a React Portal
    $$typeof: REACT_PORTAL_TYPE,
    key: resolvedKey,
    children,
    containerInfo,
    implementation,
  };
}
