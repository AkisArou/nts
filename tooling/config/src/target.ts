/**
 * Compilation targets, composed rather than selected from presets (RFC §6).
 *
 * **`id` is the load-bearing field.** It names the platform type surface a
 * program typechecks against (`@nts/platform-android-29`), it is part of the
 * cache key for any binding generated for that target, and it is what a
 * `targets: [...]` list intersects over. Two targets with the same `id` are the
 * same target; `os` and `arch` alone cannot say that, because `android-29` and
 * `android-33` share both.
 */

/** Backends the compiler can lower to (RFC §6.2). */
export type Backend = "c" | "llvm" | "jvm";

/** Architectures a native target can be built for. */
export type Arch = "x86_64" | "aarch64" | "armv7" | "wasm32";

/** Which runtime family a product executes under (RFC §6.3). */
export type RuntimeFamily = "native" | "jvm";

/**
 * The stable name of a target.
 *
 * A **package** declares support in ids -- `"android-29"` -- because it is
 * making a claim, not composing a build. A **product** carries constructed
 * `Target`s, because it is the thing being built. The id is the bridge: it names
 * the prelude package, keys the cache, and is what a target set intersects over.
 */
export type TargetId = string;

/** A resolved compilation target (RFC §6.1). */
export interface Target {
  /** Stable name: the prelude package, the cache key, the intersection key. */
  readonly id: string;
  readonly os: string;
  readonly arch?: Arch;
  readonly backend: Backend;
  /** Minimum platform version, where the platform has one. */
  readonly minimumVersion?: string;
}

/**
 * Target constructors.
 *
 * Each takes only what its platform actually has. `minSdk` is an Android fact
 * and `minimumVersion` is an Apple one; a single flat constructor would accept
 * both for either and mean neither.
 */
export const target = {
  android: (o: { readonly minSdk: number; readonly arch?: Arch }): Target => ({
    id: `android-${o.minSdk}`,
    os: "android",
    arch: o.arch ?? "aarch64",
    backend: "jvm",
    minimumVersion: String(o.minSdk),
  }),

  /** Desktop JVM. `release` is the `javac --release` level, and the default is
   *  8 because that is what `runtime/jvm/build.sh` builds the runtime jar at. */
  jvm: (o: { readonly release?: number } = {}): Target => ({
    id: `java${o.release ?? 8}`,
    os: "jvm",
    backend: "jvm",
    minimumVersion: String(o.release ?? 8),
  }),

  ios: (o: { readonly minimumVersion: string; readonly arch?: Arch }): Target => ({
    id: `ios-${o.minimumVersion}`,
    os: "ios",
    arch: o.arch ?? "aarch64",
    backend: "llvm",
    minimumVersion: o.minimumVersion,
  }),

  macos: (o: { readonly minimumVersion: string; readonly arch?: Arch }): Target => ({
    id: `macos-${o.minimumVersion}`,
    os: "macos",
    arch: o.arch ?? "aarch64",
    backend: "llvm",
    minimumVersion: o.minimumVersion,
  }),

  linux: (o: { readonly arch?: Arch; readonly backend?: Backend } = {}): Target => ({
    id: "linux-gnu",
    os: "linux",
    arch: o.arch ?? "x86_64",
    backend: o.backend ?? "llvm",
  }),

  windows: (o: { readonly arch?: Arch } = {}): Target => ({
    id: "windows",
    os: "windows",
    arch: o.arch ?? "x86_64",
    backend: "llvm",
  }),

  /** A Node addon. The only target whose artifact is a library to its host. */
  node: (o: { readonly arch?: Arch } = {}): Target => ({
    id: "node-addon",
    os: "node",
    arch: o.arch ?? "x86_64",
    backend: "c",
  }),
} as const;
