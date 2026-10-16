/**
 * @nts/sdk/camera — capture.
 *
 * Standard part (use it directly):
 *   const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
 *   const blob = await new ImageCapture(track).takePhoto();
 *   const codes = await new BarcodeDetector().detect(bitmap); // one-shot
 * Track controls (zoom/torch/focus where hardware allows) are the standard
 * `track.getCapabilities()` / `track.applyConstraints()`.
 *
 * SDK part — the two things the standards don't give an app:
 * 1. Continuous scanning of a live stream (BarcodeDetector is one-shot).
 * 2. The system camera UI as one workflow call (incl. its own prompt).
 */
import type { Availability, Size, SignalOptions } from "./core.d.ts";

/** Re-exported so `@nts/sdk/camera` is self-describing in the API reference. */
export type MediaStream = globalThis.MediaStream;
export type MediaStreamTrack = globalThis.MediaStreamTrack;
export type MediaDevices = globalThis.MediaDevices;
export type MediaDeviceInfo = globalThis.MediaDeviceInfo;
export type MediaStreamConstraints = globalThis.MediaStreamConstraints;
export type MediaRecorder = globalThis.MediaRecorder;
export type ImageCapture = globalThis.ImageCapture;
export type PhotoCapabilities = globalThis.PhotoCapabilities;
export type BarcodeDetector = globalThis.BarcodeDetector;
export type BarcodeFormat = globalThis.BarcodeFormat;
export type DetectedBarcode = globalThis.DetectedBarcode;

export interface ScanOptions extends SignalOptions {
  readonly formats?: readonly BarcodeFormat[];
  /** Max scans per second. Default: as fast as the platform allows. */
  readonly maxRate?: number;
  /** Report a code once until it leaves the frame (default) vs every frame. */
  readonly distinct?: boolean;
}

export interface BarcodeScanner {
  availability(): Promise<Availability>;
  /**
   * Scans a live video track or stream. Iterates detection batches until
   * the track ends, the iterable is broken out of, or the signal aborts.
   * The scanner does not own the stream: stopping tracks is the caller's.
   */
  scan(source: MediaStream | MediaStreamTrack, options?: ScanOptions): AsyncIterable<readonly DetectedBarcode[]>;
}

export declare const barcodeScanner: BarcodeScanner;

export interface CapturePhotoOptions extends SignalOptions {
  /** 0..1 encoder quality where format has one. Default 0.9. */
  readonly quality?: number;
}

export interface CapturedPhoto {
  /** A real File — fetch it, save it, hand it to photos.save(). */
  readonly file: File;
  readonly size: Size;
  readonly capturedAt: Date;
}

export interface Camera {
  availability(): Promise<Availability>;
  /**
   * System camera UI where the platform has one. Inherently prompts via
   * that UI; resolves null when the user backs out. For an in-app camera,
   * build on getUserMedia + ImageCapture instead.
   */
  capturePhoto(options?: CapturePhotoOptions): Promise<CapturedPhoto | null>;
  /**
   * System document-scanner UI (edge detection, perspective correction,
   * multi-page). Returns one File per page (PDF if `pdf`, else images),
   * [] when dismissed. Inherently prompts via that UI.
   */
  scanDocument(options?: SignalOptions & { readonly format?: "pdf" | "images" }): Promise<readonly File[]>;
  /**
   * System barcode-scanner UI where the platform has one; otherwise the
   * continuous `barcodeScanner.scan` over your own stream is the way.
   * Null when dismissed.
   */
  scanBarcode(options?: ScanOptions): Promise<DetectedBarcode | null>;
}

export declare const camera: Camera;
