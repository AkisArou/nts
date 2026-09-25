/**
 * The config itself.
 *
 * Two shapes share one file type, and the difference is whether anything is
 * emitted:
 *
 *   - a **package** declares `targets`, `native` and `manifests`, and no
 *     products. It is consumed by an app, which compiles it.
 *   - an **app or library** declares `products`.
 *
 * A pure-TypeScript package needs **no config at all** -- it gets its type
 * environment from `types: [...]` in its own `tsconfig.json`. The rule is that a
 * config file is required exactly where there is a build step, which is why
 * `examples/workspace/packages/storage` has none.
 */
import type { Dependencies, Manifest, NativeSources } from "./native.ts";
import type { Product } from "./product.ts";
import type { TargetId } from "./target.ts";

export interface Workspace {
  readonly root: string;
  /** Packages this workspace contains, as globs. */
  readonly packages?: readonly string[];
  /** Shared TypeScript settings the members extend. */
  readonly tsconfigBase?: string;
}

/**
 * Emitting a hook for the host build system, so a brownfield consumer does not
 * have to run us by hand.
 *
 * Every ecosystem has a "run this before compiling" hook and every one of them
 * is different: a Gradle plugin registering a task wired into `preBuild`, a
 * SwiftPM `buildToolPlugin`, a CMake `add_custom_command`, an MSBuild `.targets`
 * import, a Maven plugin bound to `generate-sources`, an npm lifecycle script.
 *
 * The adapter must stay thin -- it invokes the compiler and registers outputs --
 * or there are N implementations of the build. And it has to declare **inputs
 * and outputs** to the host, or every consumer build is a full rebuild, which is
 * the difference between a plugin that works and one that is switched off.
 */
export type Integration =
  | "gradle"
  | "swiftpm"
  | "cocoapods"
  | "cmake"
  | "msbuild"
  | "maven"
  | "npm";

/** `react` in a config. */
export interface React {
  /** Components and hooks through the React Compiler. On unless `false`; off, only JSX is lowered. */
  readonly compiler?: boolean;
  /** Which functions the compiler considers; `infer` when absent. */
  readonly compilationMode?: "infer" | "annotation" | "syntax" | "all";
}

export interface Config {
  /**
   * The program's source of truth.
   *
   * **Optional, defaulting to `./tsconfig.json` beside this file.** It was
   * mandatory and should not have been: every config in the workspace fixture
   * wrote the same string. Named only when it differs.
   *
   * **A root config that declares only `workspace` has no program**, so the
   * default does not apply to it. That is not a special case invented for this
   * sentence: `examples/workspace/nts.config.ts` names its shared settings
   * `tsconfig.base.json` on purpose, because the gate globs every
   * `tsconfig.json` one level under `examples/` -- so the default resolved to a
   * file
   * that deliberately does not exist, and the audit's path check found it.
   *
   * Referenced and never restated -- `files`, `include` and the project
   * references live there, so the two files cannot disagree about what the
   * program is made of.
   */
  readonly tsconfig?: string;

  /** Root config only. */
  readonly workspace?: Workspace;

  /** Artefacts. Absent in a package, which emits nothing of its own. */
  readonly products?: Readonly<Record<string, Product>>;

  /**
   * Package only: the targets this package claims to support.
   *
   * A claim rather than a preference -- there is no biometric prompt on a Linux
   * server. A consumer whose target is outside this set should fail at
   * *configuration* time, naming the package and the target, rather than at link
   * time with a missing symbol.
   */
  readonly targets?: readonly TargetId[];

  readonly native?: readonly NativeSources[];
  readonly manifests?: readonly Manifest[];
  readonly dependencies?: Readonly<Record<string, Dependencies>>;

  /**
   * The React stage: TSX compiled by the React Compiler and its JSX lowered
   * to React's automatic runtime, before nts reads the program. Absent, the
   * files are read as written, and JSX -- which nts does not compile -- is
   * refused.
   */
  readonly react?: React;

  /** Build-system hooks to emit for a brownfield consumer. */
  readonly integrate?: readonly Integration[];

  readonly build?: {
    readonly cache?: { readonly local?: boolean; readonly directory?: string };
  };
}

/**
 * Declare a project's build composition.
 *
 * Returns the config unchanged. It exists for the types: the compiler reads this
 * file's *value*, and whether the composition can actually be built is decided
 * at build planning, where the target and provider matrices are known (RFC
 * §27.3).
 *
 * **Evaluated by node.** An earlier draft argued for a statically evaluable
 * config on the grounds that a cache key cannot be the output of arbitrary code.
 * That was over-stated: keying on the **resolved** config -- the value this
 * returns -- is sound however it was computed. What survives is narrower and is
 * a property rather than a rule: a config reading the clock or the environment
 * resolves differently per run and misses the cache, and node becomes a
 * config-time dependency for a compiler that is otherwise Rust.
 */
export const defineConfig = (config: Config): Config => config;
