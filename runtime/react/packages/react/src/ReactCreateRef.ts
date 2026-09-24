import type { RefObject } from "shared/ReactTypes.ts";
import { isDevelopment } from "shared/Build.ts";

export function createRef<T>(): RefObject<T | null> {
  const refObject: RefObject<T | null> = { current: null };
  if (isDevelopment) {
    Object.seal(refObject);
  }
  return refObject;
}
