// A cookie jar that survives the process.
//
// `CookieJarStore` is `loadAll`/`saveAll` over a whole snapshot, and its contract says a
// durable implementation "atomically replaces the previous snapshot or rejects". That maps
// exactly onto one key in a `DurableByteStore`, whose own contract already promises that a
// key holds the old value or the new one after a crash mid-write -- never a mix and never
// absent. So the atomicity is inherited rather than reimplemented, which is the reason this
// module is small.
//
// The part that needed a decision is what to do with bytes that come back wrong.
import type { AbortSignal } from "../core/abort.ts";
import { decodeUTF8, TextEncoder } from "../core/encoding.ts";
import type { DurableByteStore } from "../storage/durable.ts";

import type { CookieJarStore, StoredCookie } from "./jar.ts";
import { validStoredCookieShape } from "./jar.ts";

/**
 * What to do about a stored cookie that does not survive validation.
 *
 * `reject` is the default and it is the safer one. A jar that silently starts empty because
 * one byte was corrupt loses a user's session with no evidence anywhere, and the caller
 * cannot distinguish it from a first run. Dropping is available because a version skew that
 * makes old records unreadable is a real situation and permanently bricking the jar is a bad
 * answer to it -- but it has to be asked for, and it reports what it dropped.
 */
export type InvalidCookiePolicy = "reject" | "drop";

export interface DurableCookieJarStoreOptions {
  /** Defaults to `"cookies"`. */
  readonly namespace?: string;
  /** Defaults to `"jar"`. One key holds the whole snapshot, because `saveAll` replaces it. */
  readonly key?: string;
  /** Defaults to `"reject"`. */
  readonly onInvalid?: InvalidCookiePolicy;
  /**
   * Called when `onInvalid` is `"drop"` and something was dropped.
   *
   * Dropping without a way to observe it is the failure this whole option exists to avoid,
   * so the report is part of the feature rather than a debugging aid.
   */
  readonly reportDropped?: (count: number, total: number) => void;
}

/** Raised when a stored snapshot cannot be read back as cookies. */
export class CookieJarStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CookieJarStoreError";
  }
}

const snapshotEncoder = new TextEncoder();

function encodeSnapshot(cookies: readonly StoredCookie[]): Uint8Array {
  // UTF-8 rather than a byte-per-code-unit shortcut. `JSON.stringify` escapes control
  // characters and lone surrogates but passes ordinary non-ASCII through literally, and a
  // cookie value is an octet string, so code units up to 0xFF reach this legitimately.
  return snapshotEncoder.encode(JSON.stringify(cookies));
}

function decodeSnapshot(bytes: Uint8Array): string {
  // Fatal, because the replacement character is the wrong answer here. A corrupt byte
  // substituted with U+FFFD produces a cookie whose value is quietly not the one that was
  // stored, and it would be sent to a server that way.
  try {
    return decodeUTF8(bytes, true);
  } catch {
    throw new CookieJarStoreError("The stored cookie snapshot is not valid UTF-8");
  }
}

/**
 * `CookieJarStore` over a provider-owned durable byte store.
 *
 * The whole jar is one key. That is not a size compromise -- `saveAll` replaces the entire
 * snapshot, so per-cookie keys would need a second mechanism to make the replacement atomic,
 * and the store already provides exactly one.
 */
export class DurableCookieJarStore implements CookieJarStore {
  private readonly store: DurableByteStore;
  private readonly namespace: string;
  private readonly key: string;
  private readonly onInvalid: InvalidCookiePolicy;
  private readonly reportDropped: ((count: number, total: number) => void) | undefined;
  private readonly signal: AbortSignal;

  constructor(
    store: DurableByteStore,
    signal: AbortSignal,
    options: DurableCookieJarStoreOptions = {},
  ) {
    this.store = store;
    this.signal = signal;
    this.namespace = options.namespace ?? "cookies";
    this.key = options.key ?? "jar";
    this.onInvalid = options.onInvalid ?? "reject";
    this.reportDropped = options.reportDropped;
  }

  async loadAll(): Promise<readonly StoredCookie[]> {
    const bytes = await this.store.read(this.namespace, this.key, this.signal);
    // An absent key is a first run, which is not a failure.
    if (bytes === null) return [];
    // Decoded outside the JSON guard on purpose: inside it, a UTF-8 failure would be
    // caught and reported as malformed JSON, which sends a reader looking at the wrong
    // layer. The two failures have different causes and different repairs.
    const text = decodeSnapshot(bytes);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new CookieJarStoreError("The stored cookie snapshot is not valid JSON");
    }
    if (!Array.isArray(parsed)) {
      throw new CookieJarStoreError("The stored cookie snapshot is not an array");
    }
    const cookies: StoredCookie[] = [];
    let dropped = 0;
    for (const entry of parsed) {
      const cookie = entry as StoredCookie;
      if (entry !== null && typeof entry === "object" && validStoredCookieShape(cookie)) {
        cookies.push(cookie);
        continue;
      }
      if (this.onInvalid === "reject") {
        throw new CookieJarStoreError("The stored cookie snapshot holds an unreadable cookie");
      }
      dropped++;
    }
    if (dropped > 0 && this.reportDropped !== undefined) {
      this.reportDropped(dropped, parsed.length);
    }
    return cookies;
  }

  async saveAll(cookies: readonly StoredCookie[]): Promise<void> {
    // Serialized before the write is opened, so a snapshot that cannot be encoded never
    // claims the key: the store refuses a second concurrent write rather than queueing it,
    // and a failure here would otherwise be paid for by the next caller.
    const bytes = encodeSnapshot(cookies);
    const write = await this.store.write(this.namespace, this.key, this.signal);
    try {
      await write.append(bytes);
      await write.commit();
    } catch (error) {
      // The store's crash contract covers a lost process, not a rejected append: without
      // this the key would keep an uncommitted write and refuse the next `saveAll`, since
      // a second concurrent write to a key is refused rather than queued.
      await write.discard();
      throw error;
    }
  }
}
