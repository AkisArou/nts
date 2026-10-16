/**
 * @nts/sdk/images — transforming image data.
 *
 * Standard parts (use directly): decode with `createImageBitmap(blob)`
 * or `ImageDecoder` (WebCodecs); draw/filter/composite in the UI layer's
 * canvas. SDK part: the batch transforms every app needs without a
 * canvas — resize, crop, rotate, flip, re-encode — as one call that
 * platforms can run in their native imaging stack.
 */
import type { Availability, SignalOptions, Size } from "./core.d.ts";

/** Re-exported so `@nts/sdk/images` is self-describing in the API reference. */
export type ImageBitmap = globalThis.ImageBitmap;
export type ImageDecoder = globalThis.ImageDecoder;
export type VideoFrame = globalThis.VideoFrame;

export type ImageSource = Blob | File | ImageBitmap | VideoFrame | Uint8Array;

export type ImageOperation =
  /** Aspect preserved unless both dimensions given. */
  | { readonly resize: { readonly width?: number; readonly height?: number } }
  | { readonly crop: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } }
  /** Degrees clockwise; arbitrary angles expand the canvas. */
  | { readonly rotate: number }
  | { readonly flip: "horizontal" | "vertical" | "both" };

export interface ImageEncodeOptions extends SignalOptions {
  /** Default `"image/jpeg"`. Unsupported formats reject `unsupported`, never silently convert. */
  readonly format?: "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/avif";
  /** 0..1 where the format has lossy quality. Default 0.9. */
  readonly quality?: number;
  /** Strip EXIF (including location) from the output. Default false. */
  readonly stripMetadata?: boolean;
}

export interface ProcessedImage {
  readonly file: File;
  readonly size: Size;
}

export interface Images {
  availability(): Promise<Availability>;
  /** Decoded size without materializing pixels unnecessarily. */
  info(source: ImageSource, options?: SignalOptions): Promise<{ readonly size: Size; readonly type: string }>;
  /** Applies operations in order and encodes the result. */
  process(
    source: ImageSource,
    operations: readonly ImageOperation[],
    options?: ImageEncodeOptions,
  ): Promise<ProcessedImage>;
}

export declare const images: Images;
