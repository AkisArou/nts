/**
 * @nts/sdk/photos — the user's photo/video library.
 * No standard covers a media library (the Web picker hands you files and
 * forgets them). Picker-first: `pick()` needs no permission anywhere.
 * Enumerating/writing the library needs `"photos"`/`"media-library"` and
 * is `unsupported` in a browser rather than faked.
 * Media content itself is the standard `File`/`Blob`, always.
 */
import type { Availability, Size, SignalOptions, TypedEventTarget } from "./core.d.ts";

/** Re-exported so `@nts/sdk/photos` is self-describing in the API reference. */
export type File = globalThis.File;
export type Blob = globalThis.Blob;

export type MediaKind = "photo" | "video";

export interface MediaAssetInfo {
  readonly filename: string;
  readonly mediaSubtypes?: readonly string[];
  /** EXIF dictionary as the OS exposes it (string-keyed by necessity). */
  readonly exif?: Readonly<Record<string, string | number>>;
  readonly location?: { readonly latitude: number; readonly longitude: number };
  readonly orientation?: number;
  readonly isFavorite?: boolean;
  readonly isInCloud?: boolean;
}

export interface MediaAsset {
  /** Stable within the library; opaque. */
  readonly id: string;
  readonly kind: MediaKind;
  readonly size: Size;
  /** For video, seconds. */
  readonly duration?: number;
  readonly createdAt?: Date;
  readonly modifiedAt?: Date;
  info(): Promise<MediaAssetInfo>;
  setFavorite(favorite: boolean): Promise<void>;
  /** Deletes from the library (OS may show its own confirmation on iOS). */
  delete(): Promise<void>;
  /** iOS/Android motion photo: the still is `file()`, the clip is `livePhotoVideo()`. */
  readonly isLivePhoto?: boolean;
  livePhotoVideo(): Promise<File | undefined>;
  file(): Promise<File>;
  thumbnail(maxSize: Size): Promise<Blob>;
}

export interface PickMediaOptions extends SignalOptions {
  readonly kinds?: readonly MediaKind[];
  /** Max items; default 1. */
  readonly limit?: number;
  /** 0..1 transcode quality for picked copies, where the picker recompresses. */
  readonly quality?: number;
  /** Max video length in seconds the picker allows selecting. */
  readonly videoMaxDuration?: number;
  /** Offer the system crop/edit step; aspect as [w,h] when fixed. */
  readonly editing?: { readonly aspect?: readonly [number, number] };
}

export interface AssetQuery {
  readonly kinds?: readonly MediaKind[];
  readonly createdAfter?: Date;
  readonly createdBefore?: Date;
  readonly favoritesOnly?: boolean;
  readonly sortBy?: "createdAt" | "modifiedAt" | "duration";
  readonly ascending?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

export interface Album {
  readonly id: string;
  readonly title: string;
  readonly count: number;
  /** System/smart albums (Favorites, Recents, Screenshots...) cannot be edited. */
  readonly isSmart?: boolean;
  assets(query?: AssetQuery): Promise<readonly MediaAsset[]>;
  add(assets: readonly MediaAsset[]): Promise<void>;
  remove(assets: readonly MediaAsset[]): Promise<void>;
  rename(title: string): Promise<void>;
  delete(): Promise<void>;
}

export interface PhotosChangeEvent extends Event {
  readonly inserted: readonly string[];
  readonly deleted: readonly string[];
  readonly updated: readonly string[];
}

export interface Photos extends TypedEventTarget<{ change: PhotosChangeEvent }> {
  availability(): Promise<Availability>;
  /** System picker. No permission. `[]` when the user backs out. */
  pick(options?: PickMediaOptions): Promise<readonly MediaAsset[]>;
  save(
    source: Blob | File,
    options?: SignalOptions & { readonly album?: string },
  ): Promise<MediaAsset>;
  /** Library enumeration. Needs `"media-library"`; unsupported in browsers. */
  albums(): Promise<readonly Album[]>;
  /** User albums only grow through here; smart albums belong to the OS. */
  createAlbum(title: string): Promise<Album>;
  /** Query across the whole library without an album. */
  query(query?: AssetQuery): Promise<readonly MediaAsset[]>;
  get(id: string): Promise<MediaAsset | undefined>;
}

export declare const photos: Photos;
