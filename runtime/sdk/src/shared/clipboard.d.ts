/**
 * @nts/sdk/clipboard — the system clipboard.
 *
 * Standard part (use it directly): Async Clipboard.
 *   await navigator.clipboard.writeText("hello");
 *   const items = await navigator.clipboard.read();
 *   items[0].types                       // ["text/plain", "image/png", ...]
 *   await items[0].getType("image/png")  // a Blob
 * `types` is also the answer to "does the clipboard have an image?" —
 * in data terms. Change notifications are the standard
 * `clipboardchange` event on navigator.clipboard.
 *
 * SDK part below covers only what the standard cannot express, and it
 * is about *side effects*, not data:
 * - `clipboardExtras.types()` inspects available types WITHOUT reading
 *   content. On iOS, checking `hasImages`-style detection does not
 *   trigger the paste consent/banner that reading does; on Android the
 *   clip *description* exposes MIME types without the data. Calling
 *   `read()` just to check would prompt/notify for nothing.
 * - `writeSensitive()` marks content sensitive (Android 13+ clipboard
 *   preview redaction, password-manager hints) — no Web equivalent.
 *
 * The iOS paste-button component (UIPasteControl) is a UI-layer
 * component, not an API here.
 */

/** Re-exported so `@nts/sdk/clipboard` is self-describing in the API reference. */
export type Clipboard = globalThis.Clipboard;
export type ClipboardItem = globalThis.ClipboardItem;
export type ClipboardChangeEvent = globalThis.ClipboardChangeEvent;

export interface ClipboardExtras {
  /**
   * MIME types currently available, without reading content and without
   * prompting where the platform distinguishes the two. Falls back to a
   * real read where it cannot (then it may prompt, like the standard).
   */
  types(): Promise<readonly string[]>;
  /**
   * Like `navigator.clipboard.write(items)`, flagged sensitive where
   * the OS supports redacting clipboard previews/history.
   */
  writeSensitive(items: ClipboardItem[]): Promise<void>;
  writeSensitiveText(text: string): Promise<void>;
}

export declare const clipboardExtras: ClipboardExtras;
