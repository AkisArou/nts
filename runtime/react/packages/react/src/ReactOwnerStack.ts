import { isDevelopment } from "shared/Build.ts";
import { ReactSharedInternals } from "./ReactSharedInternals.ts";

// The stack of components that created the element rendering now, in
// development; null otherwise.
export function captureOwnerStack(): string | null {
  if (!isDevelopment) {
    return null;
  }
  const getCurrentStack = ReactSharedInternals.getCurrentStack;
  return getCurrentStack === null ? null : getCurrentStack();
}
