import { isDevelopment } from "shared/Build.ts";
import type { AsyncDispatcher, Fiber } from "./ReactInternalTypes.ts";
import type { Cache } from "./ReactFiberCacheComponent.ts";
import { readContext } from "./ReactFiberNewContext.ts";
import { CacheContext } from "./ReactFiberCacheComponent.ts";
import { current as currentOwner } from "./ReactCurrentFiber.ts";

export function getCacheForType<T>(resourceType: () => T): T {
  const cache: Cache = readContext(CacheContext);
  let cacheForType = cache.data.get(resourceType) as T | undefined;
  if (cacheForType === undefined) {
    cacheForType = resourceType();
    cache.data.set(resourceType, cacheForType);
  }
  return cacheForType;
}

function cacheSignal(): AbortSignal | null {
  const cache: Cache = readContext(CacheContext);
  // The cache's controller is an AbortController, or a polyfill with the
  // same surface where there is none.
  const signal: unknown = cache.controller.signal;
  return signal as AbortSignal;
}

export const DefaultAsyncDispatcher: AsyncDispatcher = {
  getCacheForType,
  cacheSignal,
};

if (isDevelopment) {
  DefaultAsyncDispatcher.getOwner = (): Fiber | null => {
    return currentOwner;
  };
}
