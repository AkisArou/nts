/**
 * @nts/sdk/share — fully standard: use `navigator.share(data)` /
 * `navigator.canShare(data)` (Web Share API) directly, including `File`s
 * from camera/photos/documents in `data.files`. Dismissal of the share
 * sheet rejects with `AbortError` — that is the standard's contract and,
 * since we do not wrap it, ours too. This module adds nothing; it exists
 * so the capability is discoverable in the SDK reference.
 * https://www.w3.org/TR/web-share/
 */

/** Re-exported so `@nts/sdk/share` is self-describing in the API reference. */
export type ShareData = globalThis.ShareData;
