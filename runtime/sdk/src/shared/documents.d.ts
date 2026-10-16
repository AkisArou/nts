/**
 * @nts/sdk/documents — documents that live outside the app.
 *
 * Standard parts (use directly):
 * - App-private storage: OPFS — `await navigator.storage.getDirectory()`
 *   gives a `FileSystemDirectoryHandle` tree. On native targets it is
 *   backed by the app sandbox.
 * - File contents: `File`/`Blob`; editing a handle:
 *   `FileSystemFileHandle.createWritable()`.
 *
 * SDK part: what handles from a picker mean on an OS — grants that can be
 * persisted and re-opened, known user folders, and an open/save workflow
 * that exists on mobile where there is no `showOpenFilePicker`.
 */
import type { Availability, SignalOptions, TypedEventTarget } from "./core.d.ts";

/** Re-exported so `@nts/sdk/documents` is self-describing in the API reference. */
export type File = globalThis.File;
export type Blob = globalThis.Blob;
export type FileSystemHandle = globalThis.FileSystemHandle;
export type FileSystemFileHandle = globalThis.FileSystemFileHandle;
export type FileSystemDirectoryHandle = globalThis.FileSystemDirectoryHandle;
export type FileSystemWritableFileStream = globalThis.FileSystemWritableFileStream;
export type StorageManager = globalThis.StorageManager;
export type FileSystemObserver = globalThis.FileSystemObserver;
export type FileSystemChangeRecord = globalThis.FileSystemChangeRecord;

/**
 * A user-granted external document. It IS usable as the standard handle
 * via `handle`, and additionally carries what a `File` cannot: identity
 * that survives restarts (`id`, storable as a string), grant state, and
 * an OS display name. Android SAF documents may have no filesystem path
 * at all — `url` is then a `content:` URL, faithfully.
 */
export interface DocumentHandle {
  /** Persist this string; `documents.fromId()` reopens it after restart. */
  readonly id: string;
  readonly name: string;
  readonly url: URL;
  readonly handle: FileSystemFileHandle;
  getFile(): Promise<File>;
  /** "granted" | "denied" | "prompt", as `FileSystemHandle` permission state. */
  queryPermission(mode?: "read" | "readwrite"): Promise<PermissionState>;
  requestPermission(mode?: "read" | "readwrite"): Promise<PermissionState>;
}

export interface OpenDocumentOptions extends SignalOptions {
  /** MIME types or extensions, e.g. `["application/pdf", ".md"]`. */
  readonly types?: readonly string[];
  readonly multiple?: boolean;
}

export type KnownFolder = "documents" | "downloads" | "pictures" | "music" | "movies" | "desktop";

export interface Documents {
  availability(): Promise<Availability>;
  /** User picks a document; null (single) / [] (multiple) on dismissal. */
  open(options?: OpenDocumentOptions & { readonly multiple?: false }): Promise<DocumentHandle | null>;
  open(options: OpenDocumentOptions & { readonly multiple: true }): Promise<readonly DocumentHandle[]>;
  /** Creates a document where the user chooses (save dialog / share sheet / download). */
  save(name: string, data: Blob | File | string, options?: SignalOptions): Promise<boolean>;
  /** Reopens a persisted grant. Rejects `not-found` if revoked/deleted. */
  fromId(id: string): Promise<DocumentHandle>;
  /**
   * A standard directory handle for an OS-known folder of this user.
   * Desktop: the real folder. Mobile: the app-visible equivalents where
   * they exist, else rejects `unsupported`. Browser: rejects `unsupported`
   * (OPFS is the right tool there).
   */
  knownFolder(folder: KnownFolder): Promise<FileSystemDirectoryHandle>;
}

export declare const documents: Documents;

export declare const downloads: Downloads;

export type DownloadState = "running" | "paused" | "completed" | "failed" | "cancelled";

export interface DownloadProgress extends Event {
  readonly receivedBytes: number;
  readonly totalBytes?: number;
}

/**
 * A resumable network download into OPFS/app storage, including in the
 * background where the OS supports it (iOS/Android download services).
 * Plain `fetch` + streams covers small files; this exists for the large
 * ones the OS should own across process death. Persist `id` to reattach.
 */
export interface DownloadTask extends TypedEventTarget<{ progress: DownloadProgress }> {
  readonly id: string;
  readonly state: DownloadState;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
  /** Resolves with the finished file; rejects on failure/cancel. */
  completion: Promise<File>;
}

export interface Downloads {
  start(url: URL | string, destination: FileSystemFileHandle): Promise<DownloadTask>;
  /** Reattach to a persisted/background download after relaunch. */
  get(id: string): Promise<DownloadTask | undefined>;
  all(): Promise<readonly DownloadTask[]>;
}
