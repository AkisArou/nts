// A React root on a GTK window, as `react-dom/client`'s createRoot is on a DOM
// node:
//
//   const root = createRoot(new GtkWindow());
//   root.render(<Counter />);
//
// The root renders concurrently and installs the reconciler's sync flush as
// what runs before a controlled prop is put back (HostNode.setAfterEvent).

import type { GtkWindow } from "c:Gtk-4.0";
import type { ErrorInfo } from "react-reconciler/ReactInternalTypes.ts";
import {
  createContainer,
  defaultOnCaughtError,
  defaultOnRecoverableError,
  defaultOnUncaughtError,
  flushSyncWork,
  updateContainer,
} from "react-reconciler/ReactFiberReconciler.ts";
import { ConcurrentRoot } from "react-reconciler/ReactRootTags.ts";

import { setAfterEvent } from "./HostNode.ts";
import { GtkContainer } from "./ReactFiberConfig.ts";

export interface RootOptions {
  onUncaughtError?: (error: unknown, errorInfo: ErrorInfo) => void;
  onCaughtError?: (error: unknown, errorInfo: ErrorInfo) => void;
  onRecoverableError?: (error: unknown, errorInfo: ErrorInfo) => void;
}

export class Root {
  private readonly root: ReturnType<typeof createContainer>;

  constructor(window: GtkWindow, options: RootOptions) {
    this.root = createContainer(
      new GtkContainer(window),
      ConcurrentRoot,
      null,
      false,
      null,
      "",
      options.onUncaughtError ?? defaultOnUncaughtError,
      options.onCaughtError ?? defaultOnCaughtError,
      options.onRecoverableError ?? defaultOnRecoverableError,
      () => {},
      null,
    );
  }

  /** Renders `children` into the window, replacing what it held. */
  render(children: unknown): void {
    updateContainer(children, this.root, null, null);
  }

  /** Empties the window: every component unmounts. */
  unmount(): void {
    updateContainer(null, this.root, null, null);
  }
}

export function createRoot(window: GtkWindow, options: RootOptions = {}): Root {
  setAfterEvent(flushSyncWork);
  return new Root(window, options);
}
