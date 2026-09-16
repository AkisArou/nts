/**
 * Compilation targets, composed rather than selected from presets (RFC §6).
 *
 * **`id` is the load-bearing field.** It names the platform type surface a
 * program typechecks against (`@nts/platform-android-29`), it is part of the
 * cache key for any binding generated for that target, and it is what a
 * `targets: [...]` list intersects over. Two targets with the same `id` are the
 * same target; `os` and `arch` alone cannot say that, because `android-29` and
 * `android-33` share both.
 *
 * ## The surface is not the deployment floor
 *
 * These were one field and the audit caught it as a spelling difference, which
 * is what a conflated fact looks like from outside. `target.ios({
 * minimumVersion: "17.0" })` produced the id `ios-17.0`, every package declared
 * `"ios-17"`, and the two never intersected -- so the configuration check those
 * packages exist to demand would have rejected every iOS app in the fixture, on
 * a string compare, for a version they agree about.
 *
 * Making the id drop the minor would have fixed the symptom. The cause is that
 * **the SDK you compile against and the oldest OS you run on are different
 * numbers on every platform here**: Xcode builds against the iOS 18 SDK with a
 * deployment target of 15.0, and Gradle pairs `compileSdk` with a lower
 * `minSdk`. The surface belongs to the id because that is what the types come
 * from; the floor belongs to `minimumVersion` because that is what the linker
 * and the manifest are told. So both are accepted, and the second defaults to
 * the first.
 */

/** Backends the compiler can lower to (RFC §6.2). */
export type Backend = "c" | "llvm" | "jvm";

/**
 * Backends that produce a native object. `Backend` minus the JVM, and a real
 * distinction rather than a convenience: `target.linux({ backend: "jvm" })`
 * typechecked and produced the id `linux-gnu`, which names a libc type surface
 * a program on the JVM does not have. A desktop JVM target is `target.jvm`.
 */
export type NativeBackend = Exclude<Backend, "jvm">;

/** The platform families a target can name. One spelling each. */
export type Os = "linux" | "macos" | "windows" | "ios" | "android" | "jvm";

/**
 * Architectures a native target can be built for.
 *
 * `wasm32` was here and is gone: no backend emits it, no target constructor
 * could produce it, and it was reachable only as `target.linux({ arch:
 * "wasm32" })`, which is not a thing. It comes back with a target.
 */
export type Arch = "x86_64" | "aarch64" | "armv7";

/**
 * The stable name of a target: the platform **type surface**.
 *
 * A **package** declares support in ids -- `"android-29"` -- because it is
 * making a claim, not composing a build. A **product** carries constructed
 * `Target`s, because it is the thing being built. The id is the bridge: it names
 * the prelude package, keys the cache, and is what a target set intersects over.
 *
 * Spelled as a pattern rather than `string` for the same reason it is spelled at
 * all. The two sides of that bridge are written in different files by different
 * people, and `string` accepts `"andriod-29"`, `"linux"` and `"ios-17.0"`
 * equally. A pattern does not catch a wrong *number*, which is why the
 * constructors below derive theirs rather than taking one.
 */
export type TargetId =
  | `android-${number}`
  | `java-${number}`
  | `ios-${number}`
  | `macos-${number}`
  | `node-api-${number}`
  | "linux-gnu"
  | "windows";

/** A resolved compilation target (RFC §6.1). */
export interface Target {
  /** Stable name of the type surface: the prelude package, the cache key. */
  readonly id: TargetId;
  /**
   * The platform family, in one vocabulary.
   *
   * **`macos` and `windows`, not `darwin` and `win32`.** `target.node` took a
   * free `string` and `apps/node-brownfield` spelled its machines npm's way,
   * so the same field held two vocabularies depending on which constructor a
   * config used -- and anything reading it had to know both, or silently work
   * for some targets and not others. Cross-compilation was where that bit:
   * `win32` matched no platform, so a Windows addon reported "no cross
   * compiler configured for that pair" about a pair that is ordinary.
   */
  readonly os: Os;
  readonly arch?: Arch;
  readonly backend: Backend;
  /**
   * Oldest platform version the artifact runs on, where the platform has one.
   *
   * Not the same number as the id's. The id is what the program typechecks
   * against and this is what it is allowed to assume at run time.
   */
  readonly minimumVersion?: string;
}

/** `"17.0"` and `"17"` name one SDK. The id takes the major. */
/**
 * The backend a native target gets when the config does not name one.
 *
 * **`c`, because it is the one that produces an artifact.** This was `llvm`,
 * and the llvm lane renders to stdout -- its slice is scalar and there is no
 * runtime to place beside it -- so every native target that did not say
 * `backend: "c"` out loud refused at build time. `examples/library` carries a
 * comment about having to say it, which is the shape of a default that does not
 * work: the workaround gets written down instead of the default getting fixed.
 * `target.windows()`, `ios()` and `macos()` did not even take the option, so a
 * Windows or Apple product could not be built at all.
 *
 * **It was also two answers to one question.** `app.linux({ backend })`
 * defaulted to `c` and `target.linux()` to `llvm`, so the same omission meant
 * different things depending on which constructor a config happened to use.
 * Both now read this.
 *
 * Absent is not an error, and a default that refuses is one. When the llvm lane
 * grows an `--out`, this moves and nothing else has to.
 */
const NATIVE_DEFAULT: NativeBackend = "c";

const major = (version: string): number => Number.parseInt(version, 10);

/**
 * Target constructors.
 *
 * Each takes only what its platform actually has. `minSdk` is an Android fact
 * and `minimumVersion` is an Apple one; a single flat constructor would accept
 * both for either and mean neither.
 */
export const target = {
  /**
   * Android. `compileSdk` is the `android.jar` bound against and `minSdk` is the
   * manifest floor; Gradle keeps them apart and so does this.
   */
  android: (o: {
    readonly minSdk: number;
    readonly compileSdk?: number;
    readonly arch?: Arch;
  }): Target => ({
    id: `android-${o.compileSdk ?? o.minSdk}`,
    os: "android",
    arch: o.arch ?? "aarch64",
    backend: "jvm",
    minimumVersion: String(o.minSdk),
  }),

  /** Desktop JVM. `release` is the `javac --release` level, and the default is
   *  8 because that is what `runtime/jvm/build.sh` builds the runtime jar at. */
  jvm: (o: { readonly release?: number } = {}): Target => ({
    id: `java-${o.release ?? 8}`,
    os: "jvm",
    backend: "jvm",
    minimumVersion: String(o.release ?? 8),
  }),

  /** iOS. `sdk` is the SDK major; it defaults to the deployment target's. */
  ios: (o: {
    readonly minimumVersion: string;
    readonly sdk?: number;
    readonly arch?: Arch;
    readonly backend?: NativeBackend;
  }): Target => ({
    id: `ios-${o.sdk ?? major(o.minimumVersion)}`,
    os: "ios",
    arch: o.arch ?? "aarch64",
    backend: o.backend ?? NATIVE_DEFAULT,
    minimumVersion: o.minimumVersion,
  }),

  macos: (o: {
    readonly minimumVersion: string;
    readonly sdk?: number;
    readonly arch?: Arch;
    readonly backend?: NativeBackend;
  }): Target => ({
    id: `macos-${o.sdk ?? major(o.minimumVersion)}`,
    os: "macos",
    arch: o.arch ?? "aarch64",
    backend: o.backend ?? NATIVE_DEFAULT,
    minimumVersion: o.minimumVersion,
  }),

  linux: (o: { readonly arch?: Arch; readonly backend?: NativeBackend } = {}): Target => ({
    id: "linux-gnu",
    os: "linux",
    arch: o.arch ?? "x86_64",
    backend: o.backend ?? NATIVE_DEFAULT,
  }),

  windows: (
    o: { readonly arch?: Arch; readonly backend?: NativeBackend } = {},
  ): Target => ({
    id: "windows",
    os: "windows",
    arch: o.arch ?? "x86_64",
    backend: o.backend ?? NATIVE_DEFAULT,
  }),

  /**
   * A Node addon. The only target whose artifact is a library to its host.
   *
   * **The Node-API version is the surface, so it is the id.** That is the whole
   * point of targeting N-API: one binary keeps working across Node majors
   * because the ABI is versioned, and the version decides which functions exist
   * -- which is what a type surface is. `os` and `arch` are the machine, and
   * several of them share one id, because a darwin-arm64 addon and a linux-x64
   * addon typecheck against exactly the same thing.
   */
  node: (o: {
    readonly apiVersion?: number;
    readonly os?: Os;
    readonly arch?: Arch;
  } = {}): Target => ({
    id: `node-api-${o.apiVersion ?? 8}`,
    os: o.os ?? "linux",
    arch: o.arch ?? "x86_64",
    backend: "c",
  }),
} as const;
