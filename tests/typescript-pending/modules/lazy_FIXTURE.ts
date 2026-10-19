// A module loaded by dynamic import, for dynamic-import.ts.
const registry = globalThis as { lazyLoads?: number };
registry.lazyLoads = (registry.lazyLoads ?? 0) + 1;
export const answer = 42;
export function describe(): string {
  return `answer ${answer}`;
}
