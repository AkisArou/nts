/**
 * Products: what a build emits.
 *
 * **Every kind here is constructible.** An earlier version exported a
 * `ProductKind` union of ten names, referenced it from nothing -- not even
 * inside its own file -- and permitted three. A type naming a capability nothing
 * can express reads as support and is not.
 *
 * **Constructors are per target**, and that is the point of them. One flat
 * library type accepts every field for every platform, so `soname` on an Android
 * library and `javaPackage` on a Linux one are both expressible and neither
 * means anything. Here the invalid combinations stop being sayable.
 *
 * ## What was removed, and why
 *
 * Four things came from RFC §6 and §34 and were carried without being checked
 * against anything that exists.
 *
 * - **`runtime.family`** was `"native" | "jvm"` and is decided entirely by the
 *   target's backend. Two derivations of one fact, and the config's was the one
 *   that could disagree.
 * - **`host`** was a `HostSpec` of five bare `string`s -- `scheduler`,
 *   `frameClock`, `fetch`, `websocket`, `ui` -- so `host.android({ fetch:
 *   "banana" })` typechecked. Nothing read any of them. The axis is real (iOS
 *   and macOS differ in exactly this) and it is carried by the constructor:
 *   `app.ios` is UIKit because it is `app.ios`. It comes back when something
 *   consumes it, with values rather than strings.
 * - **`profiles: ApiProfile[]`** named nine API profiles. The compiler has no
 *   notion of a profile.
 * - **`debug: DebugProfile`** named five debug levels. Nothing emits them.
 *
 * None of this is a judgement about the RFC; it is day-one text, and these are
 * the parts that had not met an implementation yet.
 */
import type { Arch, NativeBackend, Target } from "./target.ts";
import { target as t } from "./target.ts";

/** Everything a build can emit. Each value is produced by a constructor below. */
export type ProductKind =
  | "application"
  | "executable"
  | "aar"
  | "jar"
  | "xcframework"
  | "shared-library"
  | "static-library"
  | "node-addon";

interface ProductBase {
  readonly entry: string;
  /** One target, or several when everything except the target is the same. */
  readonly targets: readonly Target[];
}

export interface AppProduct extends ProductBase {
  readonly kind: "application" | "executable";
  /** Reverse-DNS identifier, where the platform needs one. */
  readonly id?: string;
}

interface LibraryBase extends ProductBase {
  /**
   * Names crossing the public ABI. Managed objects never do (RFC §27.2).
   *
   * **Optional, defaulting to the entry module's exports**, because that is
   * what it already says. Measured across the workspace fixture before this was
   * relaxed: eight library configs declared `exports`, and in **eight of eight**
   * the list was identical to the entry's -- a second statement of one fact,
   * agreeing today, with nothing keeping it agreeing.
   *
   * It is a **narrower**, not a declaration. Naming fewer than the source
   * exports shrinks the ABI *and* the binary, because this becomes
   * `hir::reachable::Roots::Entry` and the rest stops being a root;
   * `reachability.rs` tests that, including the case where a name is not an
   * export at all. So it earns its place only where the entry is a barrel that
   * re-exports more than the artifact should carry.
   *
   * Where it disagrees with the source and is *wider*, the source is the one to
   * change: an `export` that should not be public is a missing keyword, not a
   * config entry. That is most obvious on a Node addon, where the artifact's
   * surface is literally the module's exports and there is no visibility
   * mechanism underneath for a config to select from.
   */
  readonly exports?: readonly string[];
}

export interface AarProduct extends LibraryBase {
  readonly kind: "aar";
  /** Package for the generated classes. `nts.gen` is unacceptable in a shipped artifact. */
  readonly javaPackage: string;
  /** R8 rules shipped to the consumer, so their minifier keeps what reflection reaches. */
  readonly consumerProguard?: string;
}

export interface JarProduct extends LibraryBase {
  readonly kind: "jar";
  readonly javaPackage: string;
}

/**
 * The Apple **distribution** artifact, which is not the Apple equivalent of a
 * `.so`.
 *
 * Three levels get collapsed into one by the name, and they are not the same
 * thing:
 *
 *   `.dylib`        the shared library itself -- this is what `.so` is
 *   `.framework`    a bundle: that binary plus headers, a module map, Info.plist
 *   `.xcframework`  several frameworks, one slice per platform *and* per
 *                   environment
 *
 * **XCFramework exists for a problem `.so` does not have.** A universal binary
 * cannot hold both an `arm64` iOS *device* slice and an `arm64` iOS *simulator*
 * slice: same architecture, different platform triple, and `lipo` has nowhere to
 * put the distinction. An `.xcframework` is the container that can.
 *
 * So this is chosen by **how the artifact is consumed**, not by which platform
 * it targets. A macOS program linking with clang or CMake wants `library.native`
 * and a `.dylib`, exactly as on Linux. A SwiftPM `binaryTarget` or a CocoaPods
 * `vendored_frameworks` wants this.
 */
export interface XcframeworkProduct extends LibraryBase {
  readonly kind: "xcframework";
  /** The Swift module a consumer writes `import` for. */
  readonly moduleName: string;
}

/**
 * A shared library with a C ABI: `.so`, `.dylib`, `.dll`.
 *
 * One product across Linux, macOS and Windows, because it is one *kind* of
 * artifact with per-platform packaging rather than three kinds. What differs
 * between them is **derived, not configured**, which is the lesson the rest of
 * this audit kept producing:
 *
 *   - **the import library** on Windows is emitted always. A `.dll` without its
 *     `.lib` cannot be linked against, so it was never a choice;
 *   - **the `.pc`** on unix is emitted always, because a consumer that cannot
 *     find the library hard-codes a path, and a hard-coded path is how a library
 *     stops being redistributable;
 *   - **a module-definition file** is gone entirely. A `.def` is an alternative
 *     way to say which symbols are exported, and we generate the code -- the
 *     export list is `exports`, and having two spellings of it is the duplicate
 *     that field just lost.
 */
export interface NativeLibraryProduct extends LibraryBase {
  readonly kind: "shared-library" | "static-library";
  /**
   * Versioned soname, so an ABI break is a link error rather than a crash.
   *
   * An **override**. The default is derived from the product name and version;
   * this is for a library that must match a name it did not choose.
   */
  readonly soname?: string;
  /** The installed header. Defaults to the product name. */
  readonly header?: string;
  /**
   * Prefix on every exported C symbol. Defaults to the product name.
   *
   * The one library kind that had no way to name its namespace. An AAR has
   * `javaPackage` and an XCFramework has `moduleName`; C has one flat namespace
   * per process, so `digest` from two libraries is a silent interposition at
   * load rather than a link error -- and `apps/linux-brownfield` had this
   * written in a comment, as something a shared library owes its consumer, with
   * no field to say it in.
   */
  readonly prefix?: string;
}

/**
 * A Node addon.
 *
 * **`apiVersion` and `platforms` are both gone from this type**, and for the two
 * different reasons this audit keeps finding.
 *
 * `apiVersion` moved to the target, because the Node-API version *is* the type
 * surface -- it decides which functions exist, which is the thing an id names.
 *
 * `platforms` was `readonly string[]`, held `["darwin-arm64", "linux-x64"]`, and
 * described where the addon runs. So does `targets`. Two fields for one axis,
 * one of them bare strings a typo passes through, and the fixture had them
 * disagreeing already: `targets` said x86_64 and `platforms` named four
 * machines including two that were not it. The fan-out is `targets`, and
 * `library.node({ platforms })` still writes it that way -- it builds them.
 *
 * There is no namespace field, and that is not the omission `prefix` was. A
 * `.node` is opened with `dlopen` and publishes through its N-API registration
 * rather than through exported C symbols, so there is no flat namespace for two
 * addons to collide in.
 */
export interface NodeAddonProduct extends LibraryBase {
  readonly kind: "node-addon";
}

export type LibraryProduct =
  | AarProduct
  | JarProduct
  | XcframeworkProduct
  | NativeLibraryProduct
  | NodeAddonProduct;

export type Product = AppProduct | LibraryProduct;

// ---------------------------------------------------------------------------
// Constructors. The callable form is the escape hatch -- several targets, or a
// platform with no constructor yet -- and everything it expresses, the sugar
// expresses more narrowly.
//
// Multiple `targets` on one product means the same product emitted once per
// target, and is honest only when everything except the target is the same.
// `apps/react` is that case; `apps/android` and `apps/ios` are not.
// ---------------------------------------------------------------------------

type AppOpts = Omit<AppProduct, "kind" | "targets">;

const appBase = (
  spec: Omit<AppProduct, "kind"> & { readonly kind?: "application" | "executable" },
): AppProduct => ({ kind: spec.kind ?? "application", ...spec });

export const app = Object.assign(appBase, {
  /**
   * `arch` takes several, because an Android app normally ships several. An APK
   * carries one `lib/<abi>/` directory per ABI and Play splits them; one arch
   * was the shape that could not say `arm64-v8a` beside `armeabi-v7a`.
   */
  android: (
    o: AppOpts & {
      readonly minSdk: number;
      readonly compileSdk?: number;
      readonly arch?: Arch | readonly Arch[];
    },
  ): AppProduct => {
    const { minSdk, compileSdk, arch, ...rest } = o;
    const arches = arch === undefined ? [undefined] : Array.isArray(arch) ? arch : [arch as Arch];
    return {
      kind: "application",
      targets: arches.map((a) => t.android({ minSdk, compileSdk, arch: a })),
      ...rest,
    };
  },
  ios: (o: AppOpts & { readonly minimumVersion: string; readonly sdk?: number }): AppProduct => {
    const { minimumVersion, sdk, ...rest } = o;
    return { kind: "application", targets: [t.ios({ minimumVersion, sdk })], ...rest };
  },
  macos: (o: AppOpts & { readonly minimumVersion: string; readonly sdk?: number }): AppProduct => {
    const { minimumVersion, sdk, ...rest } = o;
    return { kind: "application", targets: [t.macos({ minimumVersion, sdk })], ...rest };
  },
  linux: (o: AppOpts & { readonly backend?: NativeBackend }): AppProduct => {
    const { backend, ...rest } = o;
    return { kind: "application", targets: [t.linux({ backend })], ...rest };
  },
  windows: (o: AppOpts): AppProduct => ({ kind: "application", targets: [t.windows()], ...o }),
  /** No UI host: a CLI. The narrowest artifact here. */
  cli: (o: AppOpts & { readonly backend?: NativeBackend }): AppProduct => {
    const { backend, ...rest } = o;
    return { kind: "executable", targets: [t.linux({ backend: backend ?? "c" })], ...rest };
  },
});

const libraryBase = (spec: LibraryProduct): LibraryProduct => spec;

export const library = Object.assign(libraryBase, {
  /** An AAR, because a directory of class files is not a thing Gradle resolves. */
  android: (
    o: Omit<AarProduct, "kind" | "targets"> & {
      readonly minSdk: number;
      readonly compileSdk?: number;
    },
  ): AarProduct => {
    const { minSdk, compileSdk, ...rest } = o;
    return { kind: "aar", targets: [t.android({ minSdk, compileSdk })], ...rest };
  },

  /** A jar. The easiest target to ship to, and the one `nts.gen` makes unacceptable today. */
  jvm: (
    o: Omit<JarProduct, "kind" | "targets"> & { readonly release?: number },
  ): JarProduct => {
    const { release, ...rest } = o;
    return { kind: "jar", targets: [t.jvm({ release })], ...rest };
  },

  /**
   * A shared library, for one or more of Linux, macOS and Windows.
   *
   * `.so`, `.dylib` and `.dll` are one kind of artifact with different
   * packaging, so this is one constructor over several targets rather than
   * three. **A macOS consumer linking with clang or CMake wants this**, not
   * `library.xcframework`: the Apple equivalent of a `.so` is a `.dylib`, and an
   * XCFramework sits two levels above it.
   */
  native: (o: Omit<NativeLibraryProduct, "kind">): NativeLibraryProduct => ({
    kind: "shared-library",
    ...o,
  }),

  /** A static archive, where a consumer links the code in rather than beside. */
  staticNative: (o: Omit<NativeLibraryProduct, "kind">): NativeLibraryProduct => ({
    kind: "static-library",
    ...o,
  }),

  /**
   * An XCFramework, for Xcode consumers: a SwiftPM `binaryTarget`, CocoaPods
   * `vendored_frameworks`, or an app embedding it.
   *
   * Takes the Apple targets **together**, because holding several platform and
   * environment slices in one artifact is the entire reason the format exists --
   * a universal binary cannot carry both an `arm64` device slice and an `arm64`
   * simulator slice, same architecture and different triple.
   */
  xcframework: (o: Omit<XcframeworkProduct, "kind">): XcframeworkProduct => ({
    kind: "xcframework",
    ...o,
  }),

  /** A Node addon, the one artifact that is real today (`emit-c --napi`). */
  node: (
    o: Omit<NodeAddonProduct, "kind" | "targets"> & {
      readonly apiVersion?: number;
      readonly platforms?: readonly { readonly os: string; readonly arch: Arch }[];
    },
  ): NodeAddonProduct => {
    const { apiVersion, platforms, ...rest } = o;
    const machines = platforms ?? [{ os: "linux", arch: "x86_64" as const }];
    return {
      kind: "node-addon",
      targets: machines.map((m) => t.node({ apiVersion, os: m.os, arch: m.arch })),
      ...rest,
    };
  },
});
