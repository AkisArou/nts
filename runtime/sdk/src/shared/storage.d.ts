/**
 * @nts/sdk/storage — app key/value settings.
 * The one justified workflow wrapper in this area: the Web offers sync
 * `localStorage` (blocks) or IndexedDB (verbose); every native platform
 * has a preferences store. This is the small async common denominator,
 * for settings-sized values. Structured data: OPFS files (documents
 * module) or SQLite via the Node layer on targets that have it.
 * Secrets do NOT belong here — see @nts/sdk/security.
 */
import type { SignalOptions, TypedEventTarget } from "./core.d.ts";

/** Re-exported so `@nts/sdk/storage` is self-describing in the API reference. */
export type StorageManager = globalThis.StorageManager;

export interface StorageChangeEvent extends Event {
  readonly key: string;
  /** Fired only for other processes'/windows' writes, never our own. */
}

/**
 * Values round-trip with their type (`set("n", 1)` → number `1`).
 * Anything structured-cloneable is accepted. A missing key reads
 * `undefined`, so `undefined` itself cannot be stored.
 */
export interface KeyValueStorage extends TypedEventTarget<{ change: StorageChangeEvent }> {
  get(key: string): Promise<unknown>;
  getString(key: string): Promise<string | undefined>;
  getNumber(key: string): Promise<number | undefined>;
  getBoolean(key: string): Promise<boolean | undefined>;
  set(key: string, value: unknown, options?: SignalOptions): Promise<void>;
  remove(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  keys(): Promise<readonly string[]>;
  clear(): Promise<void>;
}

export declare const storage: KeyValueStorage;
