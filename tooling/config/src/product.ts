import type {
  ApiProfile,
  Capability,
  DebugProfile,
  HostEnvironment,
  RuntimeFamily,
  Target,
  Workspace,
} from "./build.ts";
import type { MemoryProvider } from "./memory.ts";

/** Product kinds a build can emit (RFC §6.8, §27). */
export type ProductKind =
  | "executable"
  | "static-library"
  | "shared-library"
  | "application"
  | "framework"
  | "android-library"
  | "native-ui-sdk"
  | "host-surface-library"
  | "chromium-shell"
  | "module-package";

/**
 * How a library obtains its runtime (RFC §17.3).
 *
 * `bundled-private` gives each library an isolated runtime, which restricts it
 * to providers that support multiple instances in one process — today, RC-cycle
 * only. `build-time-composed` links one runtime across the whole product.
 */
export type RuntimeLinkage =
  | "bundled-private"
  | "build-time-composed"
  | "host-provided";

export interface RuntimeSpec {
  readonly family?: RuntimeFamily;
  readonly memory: MemoryProvider;
}

export interface HostSpec {
  readonly environment: HostEnvironment;
  readonly scheduler?: string;
  readonly frameClock?: string;
  readonly fetch?: string;
  readonly websocket?: string;
  readonly ui?: string;
}

interface ProductBase {
  readonly entry: string;
  readonly target: Target;
  readonly runtime: RuntimeSpec;
  readonly host?: HostSpec;
  readonly profiles?: readonly ApiProfile[];
  readonly capabilities?: readonly Capability[];
  readonly debug?: DebugProfile;
}

export interface AppProduct extends ProductBase {
  readonly kind: "application";
  /** Reverse-DNS application identifier, where the platform needs one. */
  readonly id?: string;
}

export interface LibraryProduct extends ProductBase {
  readonly kind: "static-library" | "shared-library";
  readonly runtimeLinkage: RuntimeLinkage;
  /** Names exported across the public ABI. Managed objects never cross it (RFC §27.2). */
  readonly exports: readonly string[];
}

export type Product = AppProduct | LibraryProduct;

export interface Config {
  readonly workspace: Workspace;
  readonly products: Readonly<Record<string, Product>>;
}

export const app = (spec: Omit<AppProduct, "kind">): AppProduct => ({
  kind: "application",
  ...spec,
});

export const library = (
  spec: Omit<LibraryProduct, "kind"> & { readonly kind?: "static" | "shared" },
): LibraryProduct => {
  const { kind = "shared", ...rest } = spec;
  return {
    ...rest,
    kind: kind === "static" ? "static-library" : "shared-library",
  };
};

/**
 * Declare a project's build composition.
 *
 * Returns the config unchanged. It exists for the types: the compiler reads this
 * file's *value*, and validation of whether the composition can actually be
 * built happens at build planning, where the target and provider matrices are
 * known (RFC §27.3).
 */
export const defineConfig = (config: Config): Config => config;
