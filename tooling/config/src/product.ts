/**
 * Products: what a build emits.
 *
 * **Every kind here is constructible.** The previous version exported a
 * `ProductKind` union of ten names, referenced it from nothing -- not even
 * inside its own file -- and permitted three of them, so `framework`,
 * `android-library` and four others were declared and unreachable. A type that
 * names a capability nothing can express reads as support and is not.
 *
 * **Constructors are per target, and that is the point of them.** One flat
 * library type has to accept every field for every platform, so `soname` on an
 * Android library and `javaPackage` on a Linux one are both expressible and
 * neither means anything. `library.android` takes `javaPackage` and no
 * `soname`; `library.linux` takes `soname` and no `javaPackage`. The invalid
 * combinations stop being sayable rather than being caught later.
 */
import type { Arch, Backend, Target } from "./target.ts";
import { target as t } from "./target.ts";
import type { MemoryProvider } from "./memory.ts";

/** Host environments a product can run in (RFC §6.5). */
export type HostEnvironment =
  | "standalone-libuv"
  | "android"
  | "ios-uikit"
  | "macos-appkit"
  | "windows-winui"
  | "gtk-glib"
  | "chromium-renderer"
  | "chromium-browser"
  | "embedder-provided";

/** API profiles a product opts into (RFC §6.6). */
export type ApiProfile =
  | "ecmascript" | "web-core" | "web-fetch" | "websocket"
  | "react" | "native-ui" | "dom" | "desktop" | "node-later";

/** How much debug information an artifact carries (RFC §6.9). */
export type DebugProfile =
  | "none" | "line-tables" | "development" | "full-private-symbols" | "release-symbols";

/**
 * How a library obtains its runtime (RFC §17.3).
 *
 * `bundled-private` gives each library an isolated runtime, which restricts it
 * to providers supporting multiple instances in one process -- today, RC-cycle
 * only. `build-time-composed` links one runtime across the whole product.
 */
export type RuntimeLinkage = "bundled-private" | "build-time-composed" | "host-provided";

export interface RuntimeSpec {
  readonly family?: "native" | "jvm";
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
  readonly runtime: RuntimeSpec;
  readonly host?: HostSpec;
  readonly profiles?: readonly ApiProfile[];
  readonly debug?: DebugProfile;
}

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

export interface AppProduct extends ProductBase {
  readonly kind: "application" | "executable";
  /** One target, or several when everything except the target is the same. */
  readonly targets: readonly Target[];
  /** Reverse-DNS identifier, where the platform needs one. */
  readonly id?: string;
}

interface LibraryBase extends ProductBase {
  readonly targets: readonly Target[];
  /** Names crossing the public ABI. Managed objects never do (RFC §27.2). */
  readonly exports: readonly string[];
  readonly runtimeLinkage?: RuntimeLinkage;
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
  | AarProduct | JarProduct | XcframeworkProduct | NativeLibraryProduct | NodeAddonProduct;

export type Product = AppProduct | LibraryProduct;

// ---------------------------------------------------------------------------
// Constructors.
//
// `app` and `library` are callable for the general case -- several targets, or
// a platform with no constructor yet -- and carry a per-platform constructor for
// every one that has defaults worth having. The callable form is the escape
// hatch rather than a parallel API: everything it can express, the sugar
// expresses more narrowly.
//
// Multiple `targets` on one product means *the same product emitted once per
// target*, and is honest only when everything except the target is the same.
// `apps/react` in the workspace fixture is that case; `apps/android` and
// `apps/ios` are not, because their runtime, memory and host all differ.
// ---------------------------------------------------------------------------

const appBase = (spec: Omit<AppProduct, "kind"> & { readonly kind?: "application" | "executable" }): AppProduct => ({
  kind: spec.kind ?? "application",
  ...spec,
});

export const app = Object.assign(appBase, {
  android: (o: Omit<AppProduct, "kind" | "targets"> & { readonly minSdk: number; readonly arch?: Arch }): AppProduct => {
    const { minSdk, arch, ...rest } = o;
    return { kind: "application", targets: [t.android({ minSdk, arch })], ...rest };
  },
  ios: (o: Omit<AppProduct, "kind" | "targets"> & { readonly minimumVersion: string }): AppProduct => {
    const { minimumVersion, ...rest } = o;
    return { kind: "application", targets: [t.ios({ minimumVersion })], ...rest };
  },
  macos: (o: Omit<AppProduct, "kind" | "targets"> & { readonly minimumVersion: string }): AppProduct => {
    const { minimumVersion, ...rest } = o;
    return { kind: "application", targets: [t.macos({ minimumVersion })], ...rest };
  },
  linux: (o: Omit<AppProduct, "kind" | "targets"> & { readonly backend?: Backend }): AppProduct => {
    const { backend, ...rest } = o;
    return { kind: "application", targets: [t.linux({ backend })], ...rest };
  },
  windows: (o: Omit<AppProduct, "kind" | "targets">): AppProduct =>
    ({ kind: "application", targets: [t.windows()], ...o }),
  /** No host, no UI: the narrowest artifact here. */
  cli: (o: Omit<AppProduct, "kind" | "targets" | "host"> & { readonly backend?: Backend }): AppProduct => {
    const { backend, ...rest } = o;
    return { kind: "executable", targets: [t.linux({ backend: backend ?? "c" })], ...rest };
  },
});

const libraryBase = (spec: LibraryProduct): LibraryProduct => spec;

export const library = Object.assign(libraryBase, {
  /** An AAR, because a directory of class files is not a thing Gradle resolves. */
  android: (o: Omit<AarProduct, "kind" | "targets"> & { readonly minSdk: number }): AarProduct => {
    const { minSdk, ...rest } = o;
    return { kind: "aar", targets: [t.android({ minSdk })], ...rest };
  },
  /** A jar. The easiest target to ship to, and the one `nts.gen` makes unacceptable today. */
  jvm: (o: Omit<JarProduct, "kind" | "targets"> & { readonly release?: number }): JarProduct => {
    const { release, ...rest } = o;
    return { kind: "jar", targets: [t.jvm({ release })], ...rest };
  },
  /** An XCFramework: per-architecture slices plus a module map, which is what Xcode resolves. */
  ios: (o: Omit<XcframeworkProduct, "kind" | "targets"> & { readonly minimumVersion: string }): XcframeworkProduct => {
    const { minimumVersion, ...rest } = o;
    return { kind: "xcframework", targets: [t.ios({ minimumVersion })], ...rest };
  },
  macos: (o: Omit<XcframeworkProduct, "kind" | "targets"> & { readonly minimumVersion: string }): XcframeworkProduct => {
    const { minimumVersion, ...rest } = o;
    return { kind: "xcframework", targets: [t.macos({ minimumVersion })], ...rest };
  },
  /** `.so` plus a `.pc`; without the latter a consumer hard-codes a path. */
  linux: (o: Omit<NativeLibraryProduct, "kind" | "targets">): NativeLibraryProduct =>
    ({ kind: "shared-library", targets: [t.linux()], pkgConfig: true, ...o }),
  /** `.dll` **and** `.lib`. Emitting one of the two fails in the consumer's link. */
  windows: (o: Omit<NativeLibraryProduct, "kind" | "targets">): NativeLibraryProduct =>
    ({ kind: "shared-library", targets: [t.windows()], importLibrary: true, ...o }),
  /** A Node addon, which is the one artifact that is real today (`emit-c --napi`). */
  node: (o: Omit<NodeAddonProduct, "kind" | "targets">): NodeAddonProduct =>
    ({ kind: "node-addon", targets: [t.node()], ...o }),
});

/**
 * Host constructors.
 *
 * The host is its own axis and not a consequence of the target:
 * `apps/ios` and `apps/macos` share a backend, a memory provider and most of a
 * native surface, and differ here. A flat `HostSpec` would let an Android
 * scheduler be paired with a UIKit surface; these will not.
 */
export const host = {
  android: (o: Omit<HostSpec, "environment"> = {}): HostSpec =>
    ({ environment: "android", scheduler: "looper", frameClock: "choreographer", ...o }),
  ios: (o: Omit<HostSpec, "environment"> = {}): HostSpec =>
    ({ environment: "ios-uikit", scheduler: "dispatch-main", frameClock: "display-link", ui: "uikit", ...o }),
  macos: (o: Omit<HostSpec, "environment"> = {}): HostSpec =>
    ({ environment: "macos-appkit", scheduler: "dispatch-main", ui: "appkit", ...o }),
  gtk: (o: Omit<HostSpec, "environment"> = {}): HostSpec =>
    ({ environment: "gtk-glib", ui: "gtk4", ...o }),
  win32: (o: Omit<HostSpec, "environment"> = {}): HostSpec =>
    ({ environment: "windows-winui", ...o }),
  /** No UI at all: a CLI, a service, a Node addon. */
  standalone: (o: Omit<HostSpec, "environment"> = {}): HostSpec =>
    ({ environment: "standalone-libuv", ...o }),
} as const;
