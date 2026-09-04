// Protocol names for Node v24.20.0's experimental `node:stream/iter` API.
//
// Each key is a module-scope constant. NTS therefore lays a symbol-keyed
// member out as an ordinary fixed field; none of these is a runtime property
// lookup or one of ECMAScript's operation-redirecting symbol hooks.

export const toStreamable = Symbol.for("Stream.toStreamable");
export const toAsyncStreamable = Symbol.for("Stream.toAsyncStreamable");
export const broadcastProtocol = Symbol.for("Stream.broadcastProtocol");
export const shareProtocol = Symbol.for("Stream.shareProtocol");
export const shareSyncProtocol = Symbol.for("Stream.shareSyncProtocol");
export const drainableProtocol = Symbol.for("Stream.drainableProtocol");

/** Internal proof that an async source already yields validated byte batches. */
export const kValidatedSource = Symbol("kValidatedSource");

/** Internal proof that a stateful transform validates and flushes itself. */
export const kValidatedTransform = Symbol("kValidatedTransform");

export interface ToStreamable {
  [toStreamable](): unknown;
}

export interface ToAsyncStreamable {
  [toAsyncStreamable](): unknown;
}

export interface Broadcastable {
  [broadcastProtocol](options?: unknown): unknown;
}

export interface Shareable {
  [shareProtocol](options?: unknown): unknown;
}

export interface SyncShareable {
  [shareSyncProtocol](options?: unknown): unknown;
}

export interface ValidatedSource extends AsyncIterable<Uint8Array[]> {
  readonly [kValidatedSource]: true;
}

export function hasToStreamable(value: unknown): value is ToStreamable {
  return value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    toStreamable in value &&
    typeof value[toStreamable] === "function";
}

export function hasToAsyncStreamable(value: unknown): value is ToAsyncStreamable {
  return value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    toAsyncStreamable in value &&
    typeof value[toAsyncStreamable] === "function";
}

export function hasBroadcastProtocol(value: unknown): value is Broadcastable {
  return value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    broadcastProtocol in value &&
    typeof value[broadcastProtocol] === "function";
}

export function hasShareProtocol(value: unknown): value is Shareable {
  return value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    shareProtocol in value &&
    typeof value[shareProtocol] === "function";
}

export function hasShareSyncProtocol(value: unknown): value is SyncShareable {
  return value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    shareSyncProtocol in value &&
    typeof value[shareSyncProtocol] === "function";
}

export function isValidatedSource(value: unknown): value is ValidatedSource {
  return value !== null &&
    typeof value === "object" &&
    kValidatedSource in value &&
    value[kValidatedSource] === true &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function";
}
