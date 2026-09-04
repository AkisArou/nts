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
export interface PipeDestination {
  writable?: boolean;
  write(chunk: unknown): boolean;
  end?(): void;
  destroy?(error?: unknown): void;
  emit(event: string, ...args: unknown[]): boolean;
  on(event: string, listener: (...args: never[]) => void): unknown;
  once?(event: string, listener: (...args: never[]) => void): unknown;
  removeListener(event: string, listener: (...args: never[]) => void): unknown;
  prependListener?(event: string, listener: (...args: never[]) => void): unknown;
  listenerCount?(event: string): number;
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
 * is allowed to rethrow. Node keeps a fallback for emitters that predate
 * `prependListener` and reaches into `_events` directly; that is preserved
 * because `pipe` accepts any object, including an event emitter from some
 * other library that bundled its own.
 */
export function prependListener(
  emitter: PipeDestination,
  event: string,
  listener: (...args: never[]) => void,
): void {
  if (typeof emitter.prependListener === "function") {
    emitter.prependListener(event, listener);
    return;
  }

  const events = (emitter as unknown as { _events?: Record<string, unknown> })._events;
  if (!events || !events[event]) {
    emitter.on(event, listener);
  } else if (Array.isArray(events[event])) {
    (events[event] as unknown[]).unshift(listener);
  } else {
    events[event] = [listener, events[event]];
  }
}

export class Stream extends EventEmitter {
  pipe<T extends PipeDestination>(destination: T, options?: PipeOptions): T {
    const source = this as unknown as {
      readable?: boolean;
      pause?(): void;
      resume?(): void;
      on(event: string, listener: (...args: never[]) => void): unknown;
      removeListener(event: string, listener: (...args: never[]) => void): unknown;
    };

    const onData = (chunk: unknown): void => {
      // The pause is the entire backpressure story in the old design: `write`
      // returning false means the destination has buffered enough, and the
      // source stops until `drain`.
      if (destination.writable && destination.write(chunk) === false && source.pause) {
        source.pause();
      }
    };
    source.on("data", onData as (...args: never[]) => void);

    const onDrain = (): void => {
      if (source.readable && source.resume) source.resume();
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
    function onError(this: PipeDestination, error: unknown): void {
      cleanup();
      if (this.listenerCount?.("error") === 0) {
        this.emit("error", error);
      }
    }

    prependListener(source as unknown as PipeDestination, "error", onError as never);
    prependListener(destination, "error", onError as never);

    function cleanup(): void {
      source.removeListener("data", onData as (...args: never[]) => void);
      destination.removeListener("drain", onDrain);

      source.removeListener("end", onEnd);
      source.removeListener("close", onClose);

      source.removeListener("error", onError as never);
      destination.removeListener("error", onError as never);

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

  /**
   * The events this stream currently has listeners for.
   *
   * Overridden because the inherited one reports a name whose listener array
   * has been emptied, and a stream is asked this to decide whether anyone is
   * still watching.
   */
  override eventNames(): (string | symbol)[] {
    const events = (this as unknown as { _events: Record<string | symbol, unknown> })._events;
    const names: (string | symbol)[] = [];
    for (const key of Reflect.ownKeys(events)) {
      const registered = events[key];
      if (
        typeof registered === "function" ||
        (Array.isArray(registered) && registered.length > 0)
      ) {
        names.push(key);
      }
    }
    return names;
  }
}
