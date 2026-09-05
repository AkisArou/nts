// Two cross-connected iterator-stream channels, from Node v24.20.0
// `lib/internal/streams/iter/duplex.js`.

import { ERR_INVALID_ARG_TYPE } from "../../../internal/errors.ts";
import { push, type PushWriter } from "./push.ts";
import type {
  AsyncByteStream,
  BackpressurePolicy,
  ByteBatch,
  StreamAbortSignal,
} from "./utils.ts";

export interface DuplexDirectionOptions {
  budget?: number;
  backpressure?: BackpressurePolicy;
}

export interface DuplexOptions extends DuplexDirectionOptions {
  signal?: StreamAbortSignal;
  a?: DuplexDirectionOptions;
  b?: DuplexDirectionOptions;
}

function validateOptionsObject(value: unknown, name: string): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ERR_INVALID_ARG_TYPE(name, "Object", value);
  }
}

class TrackedReadable implements AsyncByteStream {
  readonly #channel: DuplexChannel;
  constructor(channel: DuplexChannel) {
    this.#channel = channel;
  }
  [Symbol.asyncIterator](): AsyncIterator<ByteBatch> {
    return this.#channel.openReadableIterator();
  }
}

export class DuplexChannel {
  readonly writer: PushWriter;
  readonly #source: AsyncByteStream;
  readonly #readable: AsyncByteStream;
  #closed = false;
  #activeIterator: AsyncIterator<ByteBatch> | null = null;

  constructor(writer: PushWriter, source: AsyncByteStream) {
    this.writer = writer;
    this.#source = source;
    this.#readable = new TrackedReadable(this);
  }

  get readable(): AsyncByteStream {
    return this.#readable;
  }

  openReadableIterator(): AsyncIterator<ByteBatch> {
    const iterator = this.#source[Symbol.asyncIterator]();
    this.#activeIterator = iterator;
    return iterator;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.writer.endSync();
    const iterator = this.#activeIterator;
    this.#activeIterator = null;
    if (iterator?.return !== undefined) await iterator.return();
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
}

export function duplex(options: DuplexOptions = {}): [DuplexChannel, DuplexChannel] {
  validateOptionsObject(options, "options");
  if (options.a !== undefined) validateOptionsObject(options.a, "options.a");
  if (options.b !== undefined) validateOptionsObject(options.b, "options.b");
  if (
    options.signal !== undefined &&
    (options.signal === null ||
      typeof options.signal !== "object" ||
      !("aborted" in options.signal))
  ) {
    throw new ERR_INVALID_ARG_TYPE("options.signal", "AbortSignal", options.signal);
  }

  const aToB = push({
    budget: options.a?.budget ?? options.budget,
    backpressure: options.a?.backpressure ?? options.backpressure,
  });
  const bToA = push({
    budget: options.b?.budget ?? options.budget,
    backpressure: options.b?.backpressure ?? options.backpressure,
  });

  const channelA = new DuplexChannel(aToB.writer, bToA.readable);
  const channelB = new DuplexChannel(bToA.writer, aToB.readable);
  const signal = options.signal;
  if (signal !== undefined) {
    const abortBoth = (): void => {
      channelA.writer.fail(signal.reason);
      channelB.writer.fail(signal.reason);
    };
    if (signal.aborted) abortBoth();
    else signal.addEventListener("abort", abortBoth, { once: true });
  }
  return [channelA, channelB];
}
