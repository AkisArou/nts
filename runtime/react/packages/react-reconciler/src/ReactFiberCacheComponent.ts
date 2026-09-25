import { ReactContext } from "shared/ReactContext.ts";
import type { Fiber } from "./ReactInternalTypes.ts";

import { isDevelopment } from "shared/Build.ts";

import { pushProvider, popProvider } from "./ReactFiberNewContext.ts";
import { scheduleCallback, NormalPriority } from "./Scheduler.ts";

// What a cache aborts when its last owner releases it. Upstream uses the
// host's AbortController where there is one and this shim otherwise. On the
// client a cache's signal is never observable (`cacheSignal()` is null
// outside Server Components), so the shim serves every host, including those
// without an AbortController, and has a fixed layout.
class CacheSignal {
  aborted = false;
  readonly listeners: (() => void)[] = [];

  addEventListener(_type: string, listener: () => void): void {
    this.listeners.push(listener);
  }
}

class CacheController {
  readonly signal: CacheSignal = new CacheSignal();

  abort(): void {
    this.signal.aborted = true;
    this.signal.listeners.forEach((listener) => listener());
  }
}

function createController(): CacheController {
  return new CacheController();
}

export interface Cache {
  controller: CacheController;
  data: Map<() => unknown, unknown>;
  refCount: number;
}

export interface CacheComponentState {
  readonly parent: Cache;
  readonly cache: Cache;
}

export interface SpawnedCachePool {
  readonly parent: Cache;
  readonly pool: Cache;
}

// Cache components have no Consumer or Provider of their own: upstream leaves
// both null, this has the ones every context has, which nothing renders. The
// value is initialized at the root, so it starts null.
export const CacheContext: ReactContext<Cache> = new ReactContext<Cache>(null as unknown as Cache);

// Creates a new empty Cache instance with a ref-count of 0. The caller is responsible
// for retaining the cache once it is in use (retainCache), and releasing the cache
// once it is no longer needed (releaseCache).
export function createCache(): Cache {
  return {
    controller: createController(),
    data: new Map<() => unknown, unknown>(),
    refCount: 0,
  };
}

export function retainCache(cache: Cache): void {
  if (isDevelopment) {
    if (cache.controller.signal.aborted) {
      console.warn("A cache instance was retained after it was already freed. " + "This likely indicates a bug in React.");
    }
  }
  cache.refCount++;
}

// Cleanup a cache instance, potentially freeing it if there are no more references
export function releaseCache(cache: Cache): void {
  cache.refCount--;
  if (isDevelopment) {
    if (cache.refCount < 0) {
      console.warn("A cache instance was released after it was already freed. " + "This likely indicates a bug in React.");
    }
  }
  if (cache.refCount === 0) {
    scheduleCallback(NormalPriority, () => {
      cache.controller.abort();
      return null;
    });
  }
}

export function pushCacheProvider(workInProgress: Fiber, cache: Cache): void {
  pushProvider(workInProgress, CacheContext, cache);
}

export function popCacheProvider(workInProgress: Fiber, _cache: Cache): void {
  popProvider(CacheContext, workInProgress);
}
