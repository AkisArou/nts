/**
 * @nts/sdk/shell — desktop shell integration: menus, tray, shortcuts,
 * autostart, message dialogs, file-manager actions. Reviewed against
 * the desktop ledger (docs/desktop-ledger.md) in step 6.
 * Native-only, desktop-only; each member
 * reports availability individually (Linux depends on desktop
 * environment/portals; Wayland restricts global shortcuts to portals).
 */
import type { Availability, SignalOptions, TypedEventTarget } from "../shared/core.d.ts";
import type { Window } from "./windows.d.ts";

// ---- Menus ------------------------------------------------------------------

export type MenuRole =
  | "app" | "file" | "edit" | "view" | "window" | "help"
  | "undo" | "redo" | "cut" | "copy" | "paste" | "select-all"
  | "quit" | "close" | "minimize" | "zoom" | "about" | "preferences";

export interface MenuItem {
  readonly id?: string;
  readonly label?: string;
  /** Standard platform item; label/behavior come from the OS. */
  readonly role?: MenuRole;
  /** e.g. "CmdOrCtrl+Shift+K" — same spelling as shortcuts, below. */
  readonly accelerator?: string;
  readonly type?: "normal" | "separator" | "checkbox" | "radio" | "submenu";
  readonly checked?: boolean;
  readonly enabled?: boolean;
  readonly submenu?: readonly MenuItem[];
}

export interface MenuEvents { click: MenuClickEvent }
export interface MenuClickEvent extends Event {
  readonly itemId: string;
  readonly checked?: boolean;
}

export interface Menu extends TypedEventTarget<MenuEvents> {
  /** Pop up as a context menu (at the cursor, or a point in a window). */
  popup(options?: { readonly window?: Window; readonly x?: number; readonly y?: number }): Promise<void>;
}

export interface Menus {
  availability(): Promise<Availability>;
  build(items: readonly MenuItem[]): Menu;
  /** The application menu bar (macOS global bar / window menu elsewhere). */
  setApplicationMenu(menu: Menu | null): Promise<void>;
}

// ---- Tray ---------------------------------------------------------------------

export interface TrayOptions {
  /** Icon: PNG bytes or a template-image name (docs define resolution). */
  readonly icon: Uint8Array | string;
  readonly tooltip?: string;
  readonly menu?: Menu;
}

export interface Tray extends TypedEventTarget<{ click: Event }>, Disposable {
  setTooltip(text: string): Promise<void>;
  setIcon(icon: Uint8Array | string): Promise<void>;
  setMenu(menu: Menu | null): Promise<void>;
  [Symbol.dispose](): void;
}

export interface TrayService {
  availability(): Promise<Availability>;
  create(options: TrayOptions): Promise<Tray>;
}

// ---- Shortcuts ------------------------------------------------------------------

export interface Shortcuts {
  availability(): Promise<Availability>;
  /**
   * Global (system-wide) shortcut, e.g. "CmdOrCtrl+Alt+Space".
   * Resolves an unregister function; rejects `busy` if another app owns
   * it. Firing is an event on the returned registration object.
   */
  registerGlobal(accelerator: string, options?: SignalOptions): Promise<GlobalShortcut>;
}

export interface GlobalShortcut extends TypedEventTarget<{ press: Event }>, Disposable {
  readonly accelerator: string;
  [Symbol.dispose](): void;
}

// ---- Autostart --------------------------------------------------------------------

export interface Autostart {
  availability(): Promise<Availability>;
  isEnabled(): Promise<boolean>;
  /** Launch at login. `hidden` starts without showing a window where supported. */
  setEnabled(on: boolean, options?: { readonly hidden?: boolean }): Promise<void>;
}

// ---- Message dialogs ----------------------------------------------------------------

export interface MessageDialogOptions extends SignalOptions {
  readonly title?: string;
  readonly message: string;
  readonly detail?: string;
  readonly kind?: "info" | "warning" | "error" | "question";
  /** Button labels; first is default. Empty = platform OK. */
  readonly buttons?: readonly string[];
  readonly window?: Window;
}

export interface Dialogs {
  availability(): Promise<Availability>;
  /** Resolves the index of the chosen button, or null if dismissed. */
  message(options: MessageDialogOptions): Promise<number | null>;
}

export declare const menus: Menus;
export declare const tray: TrayService;
export declare const shortcuts: Shortcuts;
export declare const autostart: Autostart;
export declare const dialogs: Dialogs;

// ---- File-manager actions -------------------------------------------------------

export interface Shell {
  /** Show the file manager with this file selected (desktop). Accepts a path or file: URL. */
  reveal(target: string | URL): Promise<boolean>;
  /** Move to the OS trash/recycle bin. Returns false where no trash exists. */
  trash(target: string | URL): Promise<boolean>;
  /** Open a path with its default OS handler (folders included). */
  openPath(target: string | URL): Promise<boolean>;
}

export declare const shell: Shell;
