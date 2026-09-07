import type { AbortSignal } from "../core/abort.ts";
import type { BlobExternalSource } from "../file/blob.ts";

/** Metadata for one stored value. */
export interface DurableRecord {
  readonly key: string;
  readonly size: number;
  /** Provider wall-clock time of the last commit, in milliseconds. */
  readonly modifiedMilliseconds: number;
}

/**
 * A write in progress. Nothing appended is visible until {@link DurableWrite.commit}.
 *
 * Streaming exists on the write side and not the read side, which is asymmetric on
 * purpose. "Spill to disk so large payloads are not forced into RAM" cannot be served
 * by a whole-value write, because the bytes parameter *is* the payload in RAM -- the
 * whole-value form contradicts the requirement it exists for. Reading back does not
 * have that problem: {@link DurableByteStore.source} already returns a ranged
 * `BlobExternalSource`, and a second ranged-read seam in the store would be a second
 * answer to one question.
 */
export interface DurableWrite {
  /**
   * Appends bytes. Cancellation is checked here rather than interrupting a write in
   * progress; see {@link DurableByteStore.write}.
   */
  append(bytes: Uint8Array): Promise<void>;

  /**
   * Makes everything appended visible under the key, atomically and durably.
   *
   * Durably means both the bytes and the act of replacing survive a crash. Those are
   * two separate things on a filesystem -- syncing the data leaves a committed value
   * losable if the directory entry is not also synced -- and a provider that does only
   * the first is approximating durability rather than providing it.
   */
  commit(): Promise<void>;

  /** Abandons the write. Idempotent, and a no-op once committed. */
  discard(): Promise<void>;
}

/**
 * Narrow provider-owned durable byte store.
 *
 * Deliberately small. RFC 9111 freshness, `Vary`, invalidation, eviction, quota policy
 * and CacheStorage matching are shared TypeScript above this; nothing here is a
 * "storage primitive" for those. What a provider owns is bytes, atomicity, durability
 * and enumeration.
 *
 * **What a key holds after a crash mid-write is part of this contract, not a provider
 * detail:** the old value or the new one, never a mix and never absent. On a filesystem
 * that falls out of temp-file-plus-rename; a database-backed provider owes the same
 * guarantee through its own transaction. Stating it here is what lets a caller reason
 * about recovery without knowing which provider it has.
 *
 * Commit is a handle operation rather than an ABI verb pair. Separate
 * `begin`/`rollback` would force a filesystem provider to model a transaction it does
 * not have, and would let a caller open one and never close it.
 */
export interface DurableByteStore {
  /** The whole value, or null when the key is absent. */
  read(namespace: string, key: string, signal: AbortSignal): Promise<Uint8Array | null>;

  /**
   * A reopenable ranged view of the value, or null when the key is absent.
   *
   * This is the large-value read path, and it is the seam Blob already consumes, so a
   * spilled body is read back through the same code as any other external Blob.
   *
   * **A reader that has been opened keeps reading what it was opened over, even after
   * the key is replaced or deleted.** The replacement half of that was already required
   * -- a Blob composes and slices immutable ranges, and a reader that saw a replacement
   * mid-read would break it. Deletion is the same guarantee and it is what makes a
   * lifetime possible above this seam: without it nothing can release stored bytes
   * while anything might still be reading them, and every caller ends up either leaking
   * or guessing. Both current providers already behave this way; it is written down
   * here because it is now depended upon rather than merely true.
   */
  source(namespace: string, key: string, signal: AbortSignal): Promise<BlobExternalSource | null>;

  /**
   * Begins replacing a key.
   *
   * **Cancellation is cooperative and checked between chunks.** A blocking write cannot
   * be interrupted mid-syscall on every platform, and closing the descriptor underneath
   * one produces a torn file rather than a stopped write. So the guarantee this makes
   * is *no partial value becomes visible* -- not that the write stops immediately. A
   * provider that promised promptness would have to lie about it.
   *
   * **A second concurrent write to a key that already has one is refused, not queued.**
   * This ABI is sequential per key, and honouring that by waiting would turn a caller's
   * mistake into a pause -- with the pause as the only evidence it made one. Refusing
   * names it. A caller that genuinely wants the later value serializes above this seam,
   * where it can also decide which value should win; the store cannot know that.
   */
  write(namespace: string, key: string, signal: AbortSignal): Promise<DurableWrite>;

  /** Removes a key. Absent is not an error; the result says whether anything went. */
  delete(namespace: string, key: string, signal: AbortSignal): Promise<boolean>;

  /**
   * Every committed record in a namespace. Uncommitted writes are not records.
   *
   * One observation, not a key list plus a lookup per key. Two calls cannot be made
   * atomic, so a key created or removed between them makes the metadata disagree with
   * the names, and the caller has no way to tell which half is stale.
   */
  list(namespace: string, signal: AbortSignal): Promise<readonly DurableRecord[]>;

  /** Total committed bytes retained in a namespace. */
  size(namespace: string, signal: AbortSignal): Promise<number>;

  close(): Promise<void>;
}
