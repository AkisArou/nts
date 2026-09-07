// The durable-store intrinsics, as a module.
//
// The same arrangement as `socket.ts` and for the same reason: the flat
// `nts_jvm_store_*` names are the spelling the linker needs, not a vocabulary a
// program should be written in. They are named once, here.
//
// # This is not `DurableByteStore`
//
// The shared interface in `runtime/web-platform/src/storage/durable.ts` is
// promise-returning, takes an `AbortSignal`, and hands out a `DurableWrite`
// object. None of that belongs at the FFI boundary, where every call is a
// synchronous `invokestatic` over scalars, strings and one byte view. So this
// module is the *flat* half, and the adapter that gives it the shared shape
// sits above it — where the signal is checked between chunks, which is exactly
// where the ABI says cancellation is checked.
//
// # Why the two reads answer a size rather than returning bytes
//
// `read` and `list` fill a caller's window and answer **what there was**, not
// what fit. A caller that guessed too small learns the right number from the
// same call rather than from a second one, and both behave that way — two
// fill-buffer calls with different short-buffer rules would be a trap
// discovered once, painfully.
//
// Returning bytes instead would mean deciding how a nullable managed value
// crosses this table, which is an ABI question that should not get answered as
// a side effect of a storage call.

/**
 * Points the store at a directory, and sweeps whatever a crashed run left.
 *
 * There is nothing to replay: a commit is a rename, and a rename either
 * happened or did not.
 */
export function configure(root: string): void {
  nts_jvm_store_configure(root);
}

/** Abandons every write and ranged view. Committed values stay; they are on disk. */
export function close(): void {
  nts_jvm_store_close();
}

/**
 * Begins replacing a key.
 *
 * Refuses when the key already has a live write, rather than queueing. A caller
 * that wants the later value serializes above this seam, where it can also
 * decide which value should win — which the store cannot know.
 */
export function open(namespace: string, key: string): number {
  return nts_jvm_store_open(namespace, key);
}

/** Appends a window. Nothing is visible under the key until {@link commit}. */
export function append(handle: number, from: Uint8Array): void {
  nts_jvm_store_append(handle, from);
}

/** Makes everything appended visible, atomically and durably. */
export function commit(handle: number): void {
  nts_jvm_store_commit(handle);
}

/** Abandons a write and releases the key. Idempotent, and a no-op once committed. */
export function discard(handle: number): void {
  nts_jvm_store_discard(handle);
}

/** The value's full size, or `-1` when absent. Writes as much of it as fits. */
export function read(namespace: string, key: string, into: Uint8Array): number {
  return nts_jvm_store_read(namespace, key, into);
}

/** Removes a key. Absent is not an error; the answer says whether anything went. */
export function remove(namespace: string, key: string): boolean {
  return nts_jvm_store_delete(namespace, key);
}

/**
 * One snapshot of a namespace's records; answers the total byte length needed.
 *
 * `size NUL modified NUL keyByteLength NUL key` per record, concatenated.
 */
export function list(namespace: string, into: Uint8Array): number {
  return nts_jvm_store_list(namespace, into);
}

/** Total committed bytes in a namespace. */
export function size(namespace: string): number {
  return nts_jvm_store_size(namespace);
}

/**
 * An independent ranged view, or `-1` when the key is absent.
 *
 * A range that does not fit is refused rather than clamped: a prefix of a value
 * that replaced the one asked about is an answer to a different question.
 */
export function sourceOpen(
  namespace: string,
  key: string,
  start: number,
  length: number,
): number {
  return nts_jvm_store_source_open(namespace, key, start, length);
}

/** The next chunk into a window; how many bytes, or `-1` at the end of the range. */
export function sourceRead(handle: number, into: Uint8Array): number {
  return nts_jvm_store_source_read(handle, into);
}

/** Closes a ranged view. Safe on success, after a failed read, and twice. */
export function sourceClose(handle: number): void {
  nts_jvm_store_source_close(handle);
}

/** The value's byte length, or `-1` when the key is absent. */
export function sourceSize(namespace: string, key: string): number {
  return nts_jvm_store_source_size(namespace, key);
}
