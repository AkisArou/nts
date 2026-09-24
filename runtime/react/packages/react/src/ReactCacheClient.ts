// `cache` and `cacheSignal` on the client. Caching is a Server Components
// feature; on the client `cache` returns a new function with no caching, so
// that shared components work in both environments without depending on
// details (the new function has no name, no properties, and length 0).

export function cache<A extends unknown[], T>(fn: (...args: A) => T): (...args: A) => T {
  return (...args: A): T => fn(...args);
}

export function cacheSignal(): AbortSignal | null {
  return null;
}
