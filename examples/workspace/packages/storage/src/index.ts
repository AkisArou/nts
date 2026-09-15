// Pure TypeScript, no native, no config. The simplest case and the one that
// proves the rule: a package is not required to know anything about targets.
//
// It still declares `types` in its own tsconfig, because it has to typecheck in
// isolation -- in an editor, and in `tsc --noEmit` in CI -- and that is what a
// platform type surface is for.

export interface Store {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

const memory = new Map<string, string>();

export function store(): Store {
  return {
    get: (key) => memory.get(key) ?? null,
    set: (key, value) => { memory.set(key, value); },
    remove: (key) => { memory.delete(key); },
  };
}
