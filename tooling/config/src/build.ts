/** Backends the compiler can lower to (RFC §6.2). */
export type Backend = "c" | "llvm" | "jvm";

/** Which runtime family a product executes under (RFC §6.3). */
export type RuntimeFamily = "native" | "jvm";

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
  | "ecmascript"
  | "web-core"
  | "web-fetch"
  | "websocket"
  | "react"
  | "native-ui"
  | "dom"
  | "desktop"
  | "node-later";

/** Host capabilities a product requires (RFC §6.7). */
export type Capability =
  | "scheduler"
  | "timers"
  | "frame-clock"
  | "fetch-transport"
  | "websocket-transport"
  | "filesystem"
  | "network"
  | "process"
  | "ui-host"
  | "image-loader"
  | "text-measurement"
  | "clipboard"
  | "notifications"
  | "logging"
  | "lifecycle"
  | "permissions";

/** How much debug information an artifact carries (RFC §6.9). */
export type DebugProfile =
  | "none"
  | "line-tables"
  | "development"
  | "full-private-symbols"
  | "release-symbols";

/** A resolved compilation target (RFC §6.1). */
export interface Target {
  readonly os: string;
  readonly arch: string;
  readonly backend: Backend;
  /** Minimum platform version, where the platform has one. */
  readonly minimumVersion?: string;
}

/** Workspace-level settings shared by every product. */
export interface Workspace {
  readonly root: string;
  readonly tsconfig: string;
}
