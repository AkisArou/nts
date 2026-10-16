/**
 * @nts/sdk/capture — capturing the screen or other windows.
 *
 * Standard part: `navigator.mediaDevices.getDisplayMedia()` gives the
 * user the OS picker and returns a `MediaStream` — prefer it.
 * SDK part: enumerating capture sources programmatically (recording
 * tools, custom pickers). This is permission-heavy by nature:
 * `"screen-capture"`, and platforms may still interpose their own UI
 * or indicators; thumbnails may be refused even when names are listed.
 * Protecting this app FROM capture is @nts/sdk/screen-protection.
 */
import type { Availability, SignalOptions, Size } from "../shared/core.d.ts";

/** Re-exported so `@nts/sdk/capture` is self-describing in the API reference. */
export type MediaStream = globalThis.MediaStream;
export type MediaDevices = globalThis.MediaDevices;

export type CaptureSourceKind = "display" | "window";

export interface CaptureSource {
  readonly id: string;
  readonly kind: CaptureSourceKind;
  /** Window/display title as the OS provides it; may be empty when permission is limited. */
  readonly title: string;
  /** Preview image no larger than requested, where the OS allows it. */
  thumbnail(maxSize: Size): Promise<Blob | undefined>;
  /** Starts capturing this source as a standard MediaStream. */
  stream(options?: SignalOptions & { readonly audio?: boolean }): Promise<MediaStream>;
}

export interface Capture {
  availability(): Promise<Availability>;
  sources(options?: SignalOptions & { readonly kinds?: readonly CaptureSourceKind[] }): Promise<readonly CaptureSource[]>;
}

export declare const capture: Capture;

