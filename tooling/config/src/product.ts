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
import type { Arch, NativeBackend, Os, Target } from "./target.ts";
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

export interface AarProduct extends ProductBase {
  readonly kind: "aar";
  /** Package for the generated classes. `nts.gen` is unacceptable in a shipped artifact. */
  readonly javaPackage: string;
  /** R8 rules shipped to the consumer, so their minifier keeps what reflection reaches. */
  readonly consumerProguard?: string;
}

export interface JarProduct extends ProductBase {
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
export interface XcframeworkProduct extends ProductBase {
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
 *     way to say which symbols are exported, and we generate the code, so the
 *     list follows from the entry's exports. It was a second spelling of a
 *     field that has since been removed for being a second spelling itself.
 */
export interface NativeLibraryProduct extends ProductBase {
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
export interface NodeAddonProduct extends ProductBase {
  readonly kind: "node-addon";
}

/**
 * An artifact something outside the program links or imports.
 *
 * **There is no `exports` field, and removing it is the point.** It was a list
 * of the names crossing the public ABI -- required at first, then optional with
 * a documented default, then audited twice -- and it never stopped being a
 * second statement of what the entry module already exports. Measured across
 * the workspace fixture before it was relaxed: eight library configs declared
 * it, and in eight of eight the list was identical to the entry's.
 *
 * The one case that survived that audit was a helper the entry exports because
 * the package's own tests import it, which the ABI should not publish. That case
 * is real and the field was still the wrong answer to it, because it only
 * existed through a compiler default: root sets were `EveryExport`, which roots
 * at the `export` keyword in *every* module, and that is wider than any artifact
 * here can publish. Nothing outside a `.so`, a `.node`, a jar or an
 * `.xcframework` can reach an internal module -- there is one entry and its
 * surface is the ABI.
 *
 * So `entry` answers it. A product must name one to be built at all, the
 * compiler roots at what that module publishes (`Roots::EntrySurface`), and a
 * helper the entry does not export is not in the artifact. A test-only helper
 * belongs in a module the entry does not re-export, which is where every other
 * ecosystem puts it.
 *
 * `LibraryBase` went with the field. With no members left it was `ProductBase`
 * under another name, and an interface that adds nothing reads as structure.
 */
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
    // `backend` passes through: `target.linux` owns the default, and this
    // having its own was two answers to one question that disagreed.
    return { kind: "executable", targets: [t.linux({ backend })], ...rest };
  },
});

/**
 * Library constructors, and **no bare callable**, which is where this differs
 * from `app`.
 *
 * `app` is callable because `apps/react` needs it to be: one product, four
 * targets, two backends, and no per-platform constructor can say that. The
 * equivalent does not exist here. Multi-target is already the normal case --
 * `library.native` takes Linux, macOS and Windows together and
 * `library.xcframework` takes the Apple targets together -- so a bare
 * `library({ kind, targets })` had nothing left to express, and every
 * `ProductKind` has a constructor that produces it.
 *
 * It was kept for one round as an escape hatch and the audit reported it called
 * by nothing, which is the same shape as the `ProductKind` union that named ten
 * kinds and permitted three: a callable nobody calls reads as a capability. An
 * escape hatch for a case that does not exist is not an escape hatch. It comes
 * back with a kind that has no constructor.
 */
export const library = {
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
      readonly platforms?: readonly { readonly os: Os; readonly arch: Arch }[];
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
} as const;
