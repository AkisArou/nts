// The original stream, from node v24.20.0 `lib/internal/streams/legacy.js`.
//
// This is node's stream from 2010, and `require('stream')` is still this
// object with everything else hung off it. Nothing new should inherit from it;
// it is here because `Readable`, `Writable` and everything after them do, and
// because a program written against it still works.
//
// Its `pipe` is the whole of the old design: an event listener that writes
// each chunk to the destination and pauses the source when the destination
// says it is full. `Readable` replaces it with one that understands the
// modern state machine, so this implementation is what runs only for a stream
// that predates that -- which in practice means somebody's own object with
// `on('data')` and `pause()`.

import { EventEmitter } from "../../events/src/main.ts";

/**
 * As much of a destination as either `pipe` uses.
 *
 * One shape for both the legacy `pipe` here and `Readable`'s, so that the
 * override is a real override. Everything the modern one needs and the old one
 * does not is optional, because the old one genuinely accepts objects that
 * lack it -- that permissiveness is the reason it still exists.
 */
export interface PipeEventSource {
  emit(event: string, ...args: unknown[]): boolean;
  on<Args extends unknown[]>(event: string, listener: (...args: Args) => unknown): unknown;
  once?<Args extends unknown[]>(event: string, listener: (...args: Args) => unknown): unknown;
  removeListener<Args extends unknown[]>(
    event: string,
    listener: (...args: Args) => unknown,
  ): unknown;
  prependListener?<Args extends unknown[]>(
    event: string,
    listener: (...args: Args) => unknown,
  ): unknown;
  listenerCount?(event: string): number;
}

export interface PipeDestination extends PipeEventSource {
  writable?: boolean;
  write(chunk: unknown): boolean;
  end?(): void;
  destroy?(error?: unknown): void;
  writableNeedDrain?: boolean;
  _writableState?: { needDrain?: boolean; errorEmitted?: boolean };
  _readableState?: { errorEmitted?: boolean };
  /** Node's own stdout and stderr, which must not be ended by a pipe. */
  _isStdio?: boolean;
}

export interface PipeOptions {
  /** Whether to end the destination when the source ends. Default true. */
  end?: boolean | undefined;
}

/**
 * Add a listener at the *front* of the list.
 *
 * `pipe` needs its error handler to run before any the program installed,
 * because the handler's job is to tear the pipe down and a program's handler
 * is allowed to rethrow. Node's fallback for emitters that predate
 * `prependListener` reaches into their dynamic `_events` property table.
 * NTS has no such table, so a foreign legacy emitter receives an ordinary
 * listener; every NTS EventEmitter takes the normal prepend path.
 */
export function prependListener(
  emitter: PipeEventSource,
  event: string,
  listener: (...args: unknown[]) => unknown,
): void {
  if (typeof emitter.prependListener === "function") {
    emitter.prependListener(event, listener);
    return;
  }

  emitter.on(event, listener);
}

export class Stream extends EventEmitter {
  pipe<T extends PipeDestination>(destination: T, options?: PipeOptions): T | undefined {
    const source = this;

    const onData = (chunk: unknown): void => {
      // The pause is the entire backpressure story in the old design: `write`
      // returning false means the destination has buffered enough, and the
      // source stops until `drain`.
      if (
        destination.writable && destination.write(chunk) === false &&
        "pause" in source && typeof source.pause === "function"
      ) {
        source.pause();
      }
    };
    source.on("data", onData);

    const onDrain = (): void => {
      if (
        "readable" in source && source.readable &&
        "resume" in source && typeof source.resume === "function"
      ) {
        source.resume();
      }
    };
    destination.on("drain", onDrain);

    // `end: false` keeps the destination open for another source. Node's own
    // stdout and stderr opt out by a flag rather than by the option, because a
    // program that pipes to `process.stdout` almost never means "and close
    // stdout when this file is finished".
    let ended = false;
    const onEnd = (): void => {
      if (ended) return;
      ended = true;
      destination.end?.();
    };
    const onClose = (): void => {
      if (ended) return;
      ended = true;
      if (typeof destination.destroy === "function") destination.destroy();
    };

    if (!destination._isStdio && (!options || options.end !== false)) {
      source.on("end", onEnd);
      source.on("close", onClose);
    }

    // A pipe with an error in it is not a pipe any more, so the first thing an
    // error does is take it apart. Re-emitting when nothing is left listening
    // turns a silently dropped error into the unhandled `error` event it
    // should have been.
    const onError = (emitter: PipeEventSource, error: unknown): void => {
      cleanup();
      if (emitter.listenerCount?.("error") === 0) {
        emitter.emit("error", error);
      }
    };
    const onSourceError = (error: unknown): void => onError(source, error);
    const onDestinationError = (error: unknown): void => onError(destination, error);

    prependListener(source, "error", onSourceError);
    prependListener(destination, "error", onDestinationError);

    function cleanup(): void {
      source.removeListener("data", onData);
      destination.removeListener("drain", onDrain);

      source.removeListener("end", onEnd);
      source.removeListener("close", onClose);

      source.removeListener("error", onSourceError);
      destination.removeListener("error", onDestinationError);

      source.removeListener("end", cleanup);
      source.removeListener("close", cleanup);

      destination.removeListener("close", cleanup);
    }

    source.on("end", cleanup);
    source.on("close", cleanup);
    destination.on("close", cleanup);

    destination.emit("pipe", source);

    // Returned so that `a.pipe(b).pipe(c)` reads as a chain, which is the one
    // thing about the old design nobody wanted to change.
    return destination;
  }

  /** The events this stream currently has listeners for. */
  override eventNames(): (string | symbol)[] {
    return super.eventNames();
  }
}
