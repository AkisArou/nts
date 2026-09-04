// `readline.emitKeypressEvents`, from node v24.20.0
// `lib/internal/readline/emitKeypressEvents.js`.
//
// Turns a readable stream of bytes into `keypress` events. Three layers stack
// here and each exists for a different reason:
//
//   bytes -> StringDecoder -> characters -> emitKeys -> keys
//
// The decoder is not decoration. A terminal delivers whatever arrived at the
// file descriptor, so a multi-byte character can be split across two `data`
// events; decoding per event would produce two replacement characters instead
// of one letter. `StringDecoder` is exactly the thing that holds the tail of a
// partial sequence until the rest comes.
//
// The escape timeout is the other subtlety. A lone escape byte is
// indistinguishable from the start of an escape sequence -- the only thing
// separating "the user pressed Escape" from "the user pressed F5" is that
// nothing followed. So an escape at the end of a chunk starts a timer, and if
// the timer fires first the decoder is told the sequence ended. GNU readline
// uses 500ms for the same decision and calls it `keyseq-timeout`.

import { StringDecoder } from "../../string_decoder/src/main.ts";
import type { Buffer } from "../../buffer/src/main.ts";
import { setTimeout, clearTimeout } from "../../timers/src/main.ts";
import type { Timeout } from "../../timers/src/timeout.ts";
import { charLengthAt, CSI, emitKeys } from "./utils.ts";

/** GNU readline's `keyseq-timeout` default. */
const ESCAPE_CODE_TIMEOUT = 500;

const kKeypressDecoder = Symbol("keypress-decoder");
const kEscapeDecoder = Symbol("escape-decoder");

/**
 * Set by the decoder, read by the interface.
 *
 * True when the whole chunk was one character, which is how the interface
 * tells a keystroke from a paste. They are the same events either way, and
 * only the timing distinguishes them.
 */
export const kSawKeyPress = Symbol("saw-key-press");

interface KeypressStream {
  emit(event: string, ...args: unknown[]): unknown;
  on(event: string, listener: (...args: never[]) => void): unknown;
  removeListener(event: string, listener: (...args: never[]) => void): unknown;
  listenerCount(event: string): number;
  [kKeypressDecoder]?: StringDecoder;
  [kEscapeDecoder]?: Generator<void, void, string>;
}

export interface KeypressOptions {
  escapeCodeTimeout?: number | undefined;
  [kSawKeyPress]?: boolean;
  isCompletionEnabled?: boolean;
}

/** Make `stream` emit `keypress` events for what is typed into it. */
export function emitKeypressEvents(
  stream: KeypressStream,
  iface: KeypressOptions = {},
): void {
  // Installed once. A second call would build a second decoder over the same
  // bytes and every key would arrive twice.
  if (stream[kKeypressDecoder]) return;

  stream[kKeypressDecoder] = new StringDecoder("utf8");
  stream[kEscapeDecoder] = emitKeys(stream);
  // Run to the first `yield`, so the generator is waiting for a character
  // rather than waiting to start.
  stream[kEscapeDecoder].next();

  const triggerEscape = (): void => {
    stream[kEscapeDecoder]?.next("");
  };
  const escapeCodeTimeout = iface.escapeCodeTimeout ?? ESCAPE_CODE_TIMEOUT;
  let timer: Timeout | undefined;

  function onData(input: Buffer | string): void {
    if (stream.listenerCount("keypress") === 0) {
      // Nobody is listening, so stop decoding and wait to be needed again.
      // Decoding into an empty room costs a `StringDecoder` write per chunk on
      // a stream that may be carrying a file.
      stream.removeListener("data", onData as never);
      stream.on("newListener", onNewListener as never);
      return;
    }

    const string = (stream[kKeypressDecoder] as StringDecoder).write(input as never);
    if (!string) return;

    clearTimeout(timer);

    // One character in the whole chunk means a keystroke; more means a paste
    // or a pasted escape sequence.
    iface[kSawKeyPress] = charLengthAt(string, 0) === string.length;
    iface.isCompletionEnabled = false;

    let length = 0;
    for (const character of string) {
      length += character.length;
      // Completion is enabled only for the last character of the chunk, so
      // that a pasted word does not fire the completer once per letter.
      if (length === string.length) iface.isCompletionEnabled = true;

      try {
        (stream[kEscapeDecoder] as Generator<void, void, string>).next(character);
        if (length === string.length && character === CSI.kEscape) {
          // An escape with nothing after it, so far. Either more is coming in
          // the next chunk or this was the Escape key, and only time can say.
          timer = setTimeout(triggerEscape, escapeCodeTimeout);
        }
      } catch (error) {
        // The decoder is a generator, and a generator that threw is finished.
        // Replacing it keeps the stream usable; without this one malformed
        // sequence would end keypress handling for the life of the process.
        stream[kEscapeDecoder] = emitKeys(stream);
        stream[kEscapeDecoder].next();
        throw error;
      }
    }
  }

  function onNewListener(event: string): void {
    if (event !== "keypress") return;
    stream.on("data", onData as never);
    stream.removeListener("newListener", onNewListener as never);
  }

  if (stream.listenerCount("keypress") > 0) {
    stream.on("data", onData as never);
  } else {
    stream.on("newListener", onNewListener as never);
  }
}
