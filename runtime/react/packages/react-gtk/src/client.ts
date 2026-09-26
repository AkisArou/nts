// A React root on a GTK window, as `react-dom/client`'s createRoot is on a DOM
// node, or on an application, which renders its windows:
//
//   const root = createRoot(new GtkWindow());
//   root.render(<Counter />);
//
//   app.connect("activate", () => {
//     createApplicationRoot(app).render(<ApplicationWindow title="Counter"><Counter /></ApplicationWindow>);
//   });
//
// The root renders concurrently and installs the reconciler's sync flush as
// what runs before a controlled prop is put back (HostNode.setAfterEvent).

import type { GtkApplication, GtkWindow } from "c:Gtk-4.0";
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
import type { WidgetSet } from "./HostNode.ts";
import { ApplicationRoot, type HostRoot, WindowRoot } from "./HostRoot.ts";

export interface RootOptions {
  /** Widgets beyond GTK's the root creates: `[adw]` from `react-gtk/adw`. */
  widgets?: readonly WidgetSet[];
  onUncaughtError?: (error: unknown, errorInfo: ErrorInfo) => void;
  onCaughtError?: (error: unknown, errorInfo: ErrorInfo) => void;
  onRecoverableError?: (error: unknown, errorInfo: ErrorInfo) => void;
}

export class Root {
  private readonly root: ReturnType<typeof createContainer>;

  constructor(host: HostRoot, options: RootOptions) {
    this.root = createContainer(
      host,
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

  /** Renders `children` into the root, replacing what it held. */
  render(children: unknown): void {
    updateContainer(children, this.root, null, null);
  }

  /** Empties the root: every component unmounts, and every window it opened closes. */
  unmount(): void {
    updateContainer(null, this.root, null, null);
  }
}

/** A root in `window`, which holds what it renders. */
export function createRoot(window: GtkWindow, options: RootOptions = {}): Root {
  setAfterEvent(flushSyncWork);
  return new Root(new WindowRoot(window, options.widgets ?? []), options);
}

/**
 * A root for `application`, which renders its windows: each
 * `<ApplicationWindow>` at the root opens as one of the application's, and
 * closes when it is no longer rendered.
 */
export function createApplicationRoot(application: GtkApplication, options: RootOptions = {}): Root {
  setAfterEvent(flushSyncWork);
  return new Root(new ApplicationRoot(application, options.widgets ?? []), options);
}
