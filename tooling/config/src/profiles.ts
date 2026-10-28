import data from "./profiles/data.json" with { type: "json" };

/** JSON values that participate in provider and record identity. */
export type ProviderValue = null | boolean | number | string
  | readonly ProviderValue[] | { readonly [key: string]: ProviderValue };

export interface ProviderSelector {
  readonly use: string;
  /** A resolved package instance, needed to disambiguate installed copies. */
  readonly instance?: `sha256:${string}`;
  readonly options?: Readonly<Record<string, ProviderValue>>;
}

export const loopAdapters = ["libuv", "glib", "core-foundation", "win32"] as const;
export interface LoopOptions {
  readonly adapter: typeof loopAdapters[number];
}
export function loopProvider(adapter: LoopOptions["adapter"]): ProviderSelector {
  return { use: "@nts/runtime", options: { adapter } };
}

/** One kind key, matching package.json's nts.provides form. */
export type ProviderImplementation =
  | { readonly compiler: true; readonly source?: never; readonly binding?: never }
  | { readonly compiler?: never; readonly source: `./${string}`; readonly binding?: never }
  | { readonly compiler?: never; readonly source?: never; readonly binding: `${string}:${string}` };

export type ProviderClaim = ProviderImplementation & {
  readonly members?: readonly string[];
  readonly uses?: readonly ("call" | "construct" | "value")[];
  readonly requires?: readonly string[];
  readonly backends?: readonly string[];
  readonly hosts?: readonly string[];
  readonly targets?: readonly string[];
  readonly limits?: string;
};

export interface ProviderProfile {
  readonly id: string;
  readonly preferences: readonly ProviderSelector[];
  readonly pins: Readonly<Record<string, ProviderSelector>>;
  readonly denied: Readonly<Record<string, string>>;
  readonly ambient_types: {
    readonly lib: readonly string[];
    readonly types: readonly string[];
    readonly overlay: string | null;
  };
  readonly backends: readonly string[] | null;
  readonly hosts: readonly string[] | null;
}

/** Shared policy data; a preference never claims that an implementation exists.
 * Wasm remains a target. Its replacement backend has no admitted implementation
 * here until it lands, so both Wasm profiles have an empty backend set.
 */
function freeze(value: unknown): void {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
}
freeze(data);
export const profiles: Readonly<Record<keyof typeof data, ProviderProfile>> = data;
