import type { ReactContext } from "shared/ReactTypes.ts";
import type { Fiber } from "./ReactInternalTypes.ts";

import { isDevelopment } from "shared/Build.ts";
import { REACT_CONTEXT_TYPE } from "shared/ReactSymbols.ts";

import { pushProvider, popProvider } from "./ReactFiberNewContext.ts";
import { scheduleCallback, NormalPriority } from "./Scheduler.ts";

// In environments without AbortController (e.g. tests)
// replace it with a lightweight shim that only has the features we use.
interface CacheController {
  readonly signal: { readonly aborted: boolean; addEventListener(type: string, listener: () => void): void };
  abort(): void;
}

class AbortControllerShim implements CacheController {
  readonly signal: { aborted: boolean; addEventListener(type: string, listener: () => void): void };
  private readonly listeners: (() => void)[] = [];

  constructor() {
    const listeners = this.listeners;
    this.signal = {
      aborted: false,
      addEventListener: (_type: string, listener: () => void) => {
        listeners.push(listener);
      },
    };
  }

  abort(): void {
    this.signal.aborted = true;
    this.listeners.forEach((listener) => listener());
  }
}

const createController: () => CacheController =
  typeof AbortController !== "undefined" ? () => new AbortController() : () => new AbortControllerShim();

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

// We don't use Consumer/Provider for Cache components, so both are null, as
// upstream has them. The values are initialized at the root, so they start
// null too.
export const CacheContext: ReactContext<Cache> = {
  $$typeof: REACT_CONTEXT_TYPE,
  Consumer: null as unknown as ReactContext<Cache>["Consumer"],
  Provider: null as unknown as ReactContext<Cache>,
  _currentValue: null as unknown as Cache,
  _currentValue2: null as unknown as Cache,
  _threadCount: 0,
};

if (isDevelopment) {
  CacheContext._currentRenderer = null;
  CacheContext._currentRenderer2 = null;
}

// Creates a new empty Cache instance with a ref-count of 0. The caller is responsible
// for retaining the cache once it is in use (retainCache), and releasing the cache
// once it is no longer needed (releaseCache).
export function createCache(): Cache {
  return {
    controller: createController(),
    data: new Map(),
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
