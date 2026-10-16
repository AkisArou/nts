/**
 * @nts/sdk/windows — native desktop windows. Native-only: the Web's
 * Window Management API describes browser windows, not owned app
 * windows, and mobile has a single implicit window (`windows.main`).
 *
 * Rendering is deliberately not specified here: a window's `content`
 * route string is resolved by the UI layer (React/native or the Blink
 * host). This module owns the window itself — geometry, state, focus,
 * lifetime. Wayland restricts some operations (programmatic move/raise);
 * they resolve as no-ops and report via `capabilities`, not errors.
 */
import type { Availability, SignalOptions, Size, TypedEventTarget } from "../shared/core.d.ts";

export interface WindowOpenOptions extends SignalOptions {
  readonly title?: string;
  /** Route/content identifier the UI layer resolves. Required for new windows. */
  readonly content: string;
  readonly size?: Size;
  readonly minSize?: Size;
  readonly position?: { readonly x: number; readonly y: number };
  readonly resizable?: boolean;
  /** Frameless / custom title bar. Window controls become the app's problem. */
  readonly decorations?: boolean;
  readonly modalTo?: Window;
  /** Reuse/focus an existing window with this id instead of opening another. */
  readonly id?: string;
}

export type WindowState = "normal" | "minimized" | "maximized" | "fullscreen" | "hidden";

export interface WindowEvents {
  close: Event;
  focus: Event;
  blur: Event;
  resize: Event;
  statechange: Event;
}

export interface WindowCapabilities {
  readonly setPosition: boolean;
  readonly setAlwaysOnTop: boolean;
  readonly decorations: boolean;
  readonly opacity: boolean;
}

export interface Window extends TypedEventTarget<WindowEvents> {
  readonly id: string;
  readonly capabilities: WindowCapabilities;
  title: string;
  readonly state: WindowState;
  readonly focused: boolean;
  readonly closed: boolean;
  size(): Promise<Size>;
  setSize(size: Size): Promise<void>;
  position(): Promise<{ readonly x: number; readonly y: number }>;
  setPosition(position: { readonly x: number; readonly y: number }): Promise<void>;
  show(): Promise<void>;
  hide(): Promise<void>;
  focus(): Promise<void>;
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  restore(): Promise<void>;
  setFullscreen(on: boolean): Promise<void>;
  setAlwaysOnTop(on: boolean): Promise<void>;
  /** Taskbar/dock progress: 0..1, or undefined to clear. Where supported. */
  setProgress(fraction?: number): Promise<void>;
  close(): Promise<void>;
}

export interface Windows {
  availability(): Promise<Availability>;
  /** The app's main window (on mobile, the only one). */
  readonly main: Window;
  open(options: WindowOpenOptions): Promise<Window>;
  all(): Promise<readonly Window[]>;
  /** Focused window of this app, if any. */
  focused(): Promise<Window | undefined>;
}

export declare const windows: Windows;
