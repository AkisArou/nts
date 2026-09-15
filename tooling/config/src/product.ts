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
import type { Arch, Backend, Target } from "./target.ts";
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
  /** Names crossing the public ABI. Managed objects never do (RFC §27.2). */
  readonly exports: readonly string[];
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

export interface XcframeworkProduct extends LibraryBase {
  readonly kind: "xcframework";
  /** The Swift module a consumer writes `import` for. */
  readonly moduleName: string;
}

export interface NativeLibraryProduct extends LibraryBase {
  readonly kind: "shared-library" | "static-library";
  /** Versioned soname, so an ABI break is a link error rather than a crash. */
  readonly soname?: string;
  /** The installable header, which is C's equivalent of `exports`. */
  readonly header?: string;
  /** Emit a `.pc`, because on Linux that is how the search actually happens. */
  readonly pkgConfig?: boolean;
  /** Windows needs the import library beside the DLL; one without the other is unlinkable. */
  readonly importLibrary?: boolean;
  /** A `.def` naming the exported symbols, where the linker wants one. */
  readonly moduleDefinition?: string;
}

export interface NodeAddonProduct extends LibraryBase {
  readonly kind: "node-addon";
  /** Node-API version. This is what makes one binary work across Node majors. */
  readonly apiVersion: number;
  /** One binary per platform-arch; five before musl. */
  readonly platforms?: readonly string[];
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
  android: (o: AppOpts & { readonly minSdk: number; readonly arch?: Arch }): AppProduct => {
    const { minSdk, arch, ...rest } = o;
    return { kind: "application", targets: [t.android({ minSdk, arch })], ...rest };
  },
  ios: (o: AppOpts & { readonly minimumVersion: string }): AppProduct => {
    const { minimumVersion, ...rest } = o;
    return { kind: "application", targets: [t.ios({ minimumVersion })], ...rest };
  },
  macos: (o: AppOpts & { readonly minimumVersion: string }): AppProduct => {
    const { minimumVersion, ...rest } = o;
    return { kind: "application", targets: [t.macos({ minimumVersion })], ...rest };
  },
  linux: (o: AppOpts & { readonly backend?: Backend }): AppProduct => {
    const { backend, ...rest } = o;
    return { kind: "application", targets: [t.linux({ backend })], ...rest };
  },
  windows: (o: AppOpts): AppProduct => ({ kind: "application", targets: [t.windows()], ...o }),
  /** No UI host: a CLI. The narrowest artifact here. */
  cli: (o: AppOpts & { readonly backend?: Backend }): AppProduct => {
    const { backend, ...rest } = o;
    return { kind: "executable", targets: [t.linux({ backend: backend ?? "c" })], ...rest };
  },
});

const libraryBase = (spec: LibraryProduct): LibraryProduct => spec;

export const library = Object.assign(libraryBase, {
  /** An AAR, because a directory of class files is not a thing Gradle resolves. */
  android: (
    o: Omit<AarProduct, "kind" | "targets"> & { readonly minSdk: number },
  ): AarProduct => {
    const { minSdk, ...rest } = o;
    return { kind: "aar", targets: [t.android({ minSdk })], ...rest };
  },
  /** A jar. The easiest target to ship to, and the one `nts.gen` makes unacceptable today. */
  jvm: (
    o: Omit<JarProduct, "kind" | "targets"> & { readonly release?: number },
  ): JarProduct => {
    const { release, ...rest } = o;
    return { kind: "jar", targets: [t.jvm({ release })], ...rest };
  },
  /** An XCFramework: per-architecture slices plus a module map, which is what Xcode resolves. */
  ios: (
    o: Omit<XcframeworkProduct, "kind" | "targets"> & { readonly minimumVersion: string },
  ): XcframeworkProduct => {
    const { minimumVersion, ...rest } = o;
    return { kind: "xcframework", targets: [t.ios({ minimumVersion })], ...rest };
  },
  macos: (
    o: Omit<XcframeworkProduct, "kind" | "targets"> & { readonly minimumVersion: string },
  ): XcframeworkProduct => {
    const { minimumVersion, ...rest } = o;
    return { kind: "xcframework", targets: [t.macos({ minimumVersion })], ...rest };
  },
  /** `.so` plus a `.pc`; without the latter a consumer hard-codes a path. */
  linux: (o: Omit<NativeLibraryProduct, "kind" | "targets">): NativeLibraryProduct => ({
    kind: "shared-library",
    targets: [t.linux()],
    pkgConfig: true,
    ...o,
  }),
  /** `.dll` **and** `.lib`. Emitting one of the two fails in the consumer's link. */
  windows: (o: Omit<NativeLibraryProduct, "kind" | "targets">): NativeLibraryProduct => ({
    kind: "shared-library",
    targets: [t.windows()],
    importLibrary: true,
    ...o,
  }),
  /** A Node addon, the one artifact that is real today (`emit-c --napi`). */
  node: (o: Omit<NodeAddonProduct, "kind" | "targets">): NodeAddonProduct => ({
    kind: "node-addon",
    targets: [t.node()],
    ...o,
  }),
});
