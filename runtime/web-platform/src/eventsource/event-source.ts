import { AbortController } from "../core/abort.ts";
import type { EventHandlerSlot } from "../core/events.ts";
import { Event, EventTarget, MessageEvent } from "../core/events.ts";
import { DOMException, LimitError } from "../core/errors.ts";
import { latin1, TextDecoder, utf8 } from "../core/encoding.ts";
import {
  coerceToBoolean,
  coerceToUSVString,
  requireArguments,
  requireDictionary,
} from "../core/webidl.ts";
import type { CancelHandle, Scheduler, URLParser } from "../provider/primitives.ts";
import { currentWebPlatformRuntime } from "../provider/environment.ts";
import type { RequestInit } from "../fetch/request.ts";
import type { Response } from "../fetch/response.ts";
import { parseMIMEType } from "../forms/mime.ts";
import { eventTargetDispatchTrusted, eventTargetSetErrorReporter, eventTargetSetHandler } from "../core/events.ts";

export interface EventSourceInit {
  withCredentials?: boolean;
}

export interface EventSourceOptions {
  initialReconnectDelayMs?: number;
  maxEventBufferCharacters?: number;
  maxLineBufferCharacters?: number;
}

export interface EventSourcePolicy {
  readonly initialReconnectDelayMs: number;
  readonly maxEventBufferCharacters: number;
  readonly maxLineBufferCharacters: number;
}

export interface EventSourceContext {
  readonly scheduler: Scheduler;
  readonly urls: URLParser;
  readonly baseURL: string | undefined;
  readonly eventSourcePolicy: EventSourcePolicy;

  fetch(input: string, init?: RequestInit): Promise<Response>;

  registerEventSource(source: EventSource): void;

  unregisterEventSource(source: EventSource): void;
}

interface ParsedEvent {
  readonly type: string;
  readonly data: string;
  readonly lastEventId: string;
}

interface EventStreamTarget {
  dispatchParsedEvent(event: ParsedEvent): Promise<void>;

  setLastEventId(value: string): void;

  setReconnectDelay(milliseconds: number): void;
}

interface ReconnectWait {
  readonly timer: CancelHandle;
  readonly result: PromiseWithResolvers<void>;
}

export function readEventSourcePolicy(options: EventSourceOptions | undefined): EventSourcePolicy {
  const policy: EventSourcePolicy = {
    initialReconnectDelayMs: options?.initialReconnectDelayMs ?? 3000,
    maxEventBufferCharacters: options?.maxEventBufferCharacters ?? 16 * 1024 * 1024,
    maxLineBufferCharacters: options?.maxLineBufferCharacters ?? 1024 * 1024,
  };
  validateLimit(policy.initialReconnectDelayMs, "EventSource reconnect delay", true);
  validateLimit(policy.maxEventBufferCharacters, "EventSource event buffer", false);
  validateLimit(policy.maxLineBufferCharacters, "EventSource line buffer", false);
  return policy;
}

function validateLimit(value: number, name: string, allowZero: boolean): void {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new RangeError(name + " limit is invalid");
  }
}

function convertEventSourceInit(init: EventSourceInit | null | undefined): boolean {
  requireDictionary(init, "EventSource init");
  if (init === undefined || init === null) return false;
  return coerceToBoolean(init.withCredentials);
}

function reconnectMilliseconds(value: string): number | null {
  if (value.length === 0) return null;
  let result = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) return null;
    result = result * 10 + code - 48;
    if (result > Number.MAX_SAFE_INTEGER) result = Number.MAX_SAFE_INTEGER;
  }
  return result;
}

function lastEventIdHeaderValue(value: string): string {
  // HTML requires Last-Event-ID to carry the UTF-8 encoding of the event ID.
  // Fetch header values are Web IDL ByteStrings, so preserve those wire bytes
  // as code units instead of passing the Unicode string through public Headers.
  return latin1(utf8.encode(value));
}

/** Incremental parser for the HTML event-stream format. */
export class EventStreamParser {
  private readonly target: EventStreamTarget;
  private readonly policy: EventSourcePolicy;
  private line = "";
  private data = "";
  private eventType = "";
  private lastEventId = "";
  private skipLeadingLF = false;

  constructor(target: EventStreamTarget, policy: EventSourcePolicy, initialLastEventId = "") {
    this.target = target;
    this.policy = policy;
    this.lastEventId = initialLastEventId;
  }

  async push(text: string): Promise<void> {
    let start = 0;
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (this.skipLeadingLF) {
        this.skipLeadingLF = false;
        if (code === 10) {
          start = index + 1;
          continue;
        }
      }
      if (code !== 10 && code !== 13) continue;

      this.appendLineFragment(text.slice(start, index));
      await this.processLine(this.line);
      this.line = "";
      this.skipLeadingLF = code === 13;
      start = index + 1;
    }
    this.appendLineFragment(text.slice(start));
  }

  finish(): void {
    // EOF never dispatches an unterminated event or processes an unterminated line.
    this.line = "";
    this.data = "";
    this.eventType = "";
  }

  private appendLineFragment(fragment: string): void {
    if (fragment.length === 0) return;
    if (this.line.length + fragment.length > this.policy.maxLineBufferCharacters) {
      throw new LimitError("EventSource line exceeded the configured buffer limit");
    }
    this.line += fragment;
  }

  private async processLine(line: string): Promise<void> {
    if (line.length === 0) {
      await this.dispatchEvent();
      return;
    }
    if (line.charCodeAt(0) === 58) return;

    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.charCodeAt(0) === 32) value = value.slice(1);

    if (field === "event") {
      this.eventType = value;
      return;
    }
    if (field === "data") {
      if (this.data.length + value.length + 1 > this.policy.maxEventBufferCharacters) {
        throw new LimitError("EventSource event exceeded the configured buffer limit");
      }
      this.data += value + "\n";
      return;
    }
    if (field === "id") {
      if (!value.includes("\0")) this.lastEventId = value;
      return;
    }
    if (field === "retry") {
      const milliseconds = reconnectMilliseconds(value);
      if (milliseconds !== null) this.target.setReconnectDelay(milliseconds);
    }
  }

  private async dispatchEvent(): Promise<void> {
    this.target.setLastEventId(this.lastEventId);
    if (this.data.length === 0) {
      this.eventType = "";
      return;
    }

    const parsed: ParsedEvent = {
      type: this.eventType === "" ? "message" : this.eventType,
      data: this.data.slice(0, -1),
      lastEventId: this.lastEventId,
    };
    this.data = "";
    this.eventType = "";
    await this.target.dispatchParsedEvent(parsed);
  }
}

function isMessageEvent(event: Event): event is MessageEvent<string> {
  return event instanceof MessageEvent && typeof event.data === "string";
}

/** HTML server-sent events over the canonical environment-owned Fetch implementation. */
export class EventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readonly url: string;
  readonly withCredentials: boolean;

  private readonly context: EventSourceContext;
  private state = EventSource.CONNECTING;
  private reconnectDelay: number;
  private lastEventId = "";
  private connection: AbortController | null = null;
  private reconnectWait: ReconnectWait | null = null;
  private registered = false;
  private readonly openHandler: EventHandlerSlot<EventSource, Event> = {
    callback: null,
    listener: null,
  };
  private readonly messageHandler: EventHandlerSlot<EventSource, MessageEvent<string>> = {
    callback: null,
    listener: null,
  };
  private readonly errorHandler: EventHandlerSlot<EventSource, Event> = {
    callback: null,
    listener: null,
  };

  constructor(...args: [url: string, init?: EventSourceInit]) {
    requireArguments(args, 1, "EventSource constructor");
    const input = coerceToUSVString(args[0]);
    const withCredentials = convertEventSourceInit(args[1]);
    // The public API is `(url, init)`. Nothing constructs an EventSource with an
    // explicit context, so the capability is never an argument: it is read from the
    // environment and cannot be substituted by a surplus argument.
    const context = currentWebPlatformRuntime();
    super();
    this[eventTargetSetErrorReporter]((error) => context.scheduler.reportError(error));
    try {
      this.url = context.urls.parse(input, context.baseURL).href;
    } catch {
      throw new DOMException("Invalid EventSource URL", "SyntaxError");
    }
    this.withCredentials = withCredentials;
    this.context = context;
    this.reconnectDelay = context.eventSourcePolicy.initialReconnectDelayMs;
    context.registerEventSource(this);
    this.registered = true;
    context.scheduler.enqueue(() => {
      this.run().catch((error) => context.scheduler.reportError(error));
    });
  }

  get readyState(): number {
    return this.state;
  }

  get onopen(): ((this: EventSource, event: Event) => void) | null {
    return this.openHandler.callback;
  }

  set onopen(callback: ((this: EventSource, event: Event) => void) | null) {
    this[eventTargetSetHandler](this, this.openHandler, "open", callback, (_event): _event is Event => true);
  }

  get onmessage(): ((this: EventSource, event: MessageEvent<string>) => void) | null {
    return this.messageHandler.callback;
  }

  set onmessage(callback: ((this: EventSource, event: MessageEvent<string>) => void) | null) {
    this[eventTargetSetHandler](this, this.messageHandler, "message", callback, isMessageEvent);
  }

  get onerror(): ((this: EventSource, event: Event) => void) | null {
    return this.errorHandler.callback;
  }

  set onerror(callback: ((this: EventSource, event: Event) => void) | null) {
    this[eventTargetSetHandler](this, this.errorHandler, "error", callback, (_event): _event is Event => true);
  }

  close(): void {
    if (this.state === EventSource.CLOSED) return;
    this.state = EventSource.CLOSED;
    this.connection?.abort();
    this.connection = null;
    const wait = this.reconnectWait;
    this.reconnectWait = null;
    if (wait !== null) {
      wait.timer.cancel();
      wait.result.resolve();
    }
    this.unregister();
  }

  private async run(): Promise<void> {
    while (this.state !== EventSource.CLOSED) {
      const outcome = await this.connectOnce();
      if (this.state === EventSource.CLOSED) return;
      if (outcome === "fatal") {
        await this.failConnection();
        return;
      }
      if (!(await this.waitToReconnect())) return;
    }
  }

  private async connectOnce(): Promise<"reconnect" | "fatal"> {
    const controller = new AbortController();
    this.connection = controller;
    try {
      const headers: [string, string][] = [
        ["accept", "text/event-stream"],
        ["cache-control", "no-cache"],
      ];
      if (this.lastEventId !== "") {
        headers.push(["last-event-id", lastEventIdHeaderValue(this.lastEventId)]);
      }
      const init: RequestInit = {
        cache: "no-store",
        credentials: this.withCredentials ? "include" : "same-origin",
        headers,
        signal: controller.signal,
      };
      const response = await this.context.fetch(this.url, init);
      if (this.state === EventSource.CLOSED) return "fatal";
      const mime = parseMIMEType(response.headers.get("content-type") ?? "");
      if (response.status !== 200 || mime?.essence !== "text/event-stream") {
        try {
          await response.body?.cancel();
        } catch {
          // The response is already terminal; cancellation failure cannot make it reconnectable.
        }
        return "fatal";
      }

      const origin = this.context.urls.parse(response.url || this.url).origin;
      await this.queueTask(() => {
        if (this.state === EventSource.CLOSED) return;
        this.state = EventSource.OPEN;
        this[eventTargetDispatchTrusted](new Event("open"));
      });
      if (this.state === EventSource.CLOSED) return "fatal";
      await this.consume(response, origin);
      return "reconnect";
    } catch (error) {
      if (this.state === EventSource.CLOSED || controller.signal.aborted) return "fatal";
      if (error instanceof LimitError) return "fatal";
      return "reconnect";
    } finally {
      if (this.connection === controller) this.connection = null;
    }
  }

  private async consume(response: Response, origin: string): Promise<void> {
    const body = response.body;
    if (body === null) return;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const parser = new EventStreamParser(
      {
        dispatchParsedEvent: async (event) => {
          await this.queueTask(() => {
            if (this.state === EventSource.CLOSED) return;
            this[eventTargetDispatchTrusted](
              new MessageEvent<string>(event.type, {
                data: event.data,
                lastEventId: event.lastEventId,
                origin,
              }),
            );
          });
        },
        setLastEventId: (value) => {
          this.lastEventId = value;
        },
        setReconnectDelay: (milliseconds) => {
          this.reconnectDelay = milliseconds;
        },
      },
      this.context.eventSourcePolicy,
      this.lastEventId,
    );
    try {
      while (this.state !== EventSource.CLOSED) {
        const result = await reader.read();
        if (result.done) {
          const tail = decoder.decode();
          if (tail !== "") await parser.push(tail);
          parser.finish();
          return;
        }
        await parser.push(decoder.decode(result.value, { stream: true }));
      }
    } finally {
      if (this.state === EventSource.CLOSED) await reader.cancel();
      reader.releaseLock();
    }
  }

  private async waitToReconnect(): Promise<boolean> {
    await this.queueTask(() => {
      if (this.state === EventSource.CLOSED) return;
      this.state = EventSource.CONNECTING;
      this[eventTargetDispatchTrusted](new Event("error"));
    });
    if (this.state === EventSource.CLOSED) return false;

    const result = Promise.withResolvers<void>();
    const timer = this.context.scheduler.delay(this.reconnectDelay, () => {
      if (this.reconnectWait?.result !== result) return;
      this.reconnectWait = null;
      result.resolve();
    });
    this.reconnectWait = { timer, result };
    await result.promise;
    return this.state !== EventSource.CLOSED;
  }

  private async failConnection(): Promise<void> {
    await this.queueTask(() => {
      if (this.state === EventSource.CLOSED) return;
      this.state = EventSource.CLOSED;
      this.unregister();
      this[eventTargetDispatchTrusted](new Event("error"));
    });
  }

  private queueTask(task: () => void): Promise<void> {
    const result = Promise.withResolvers<void>();
    this.context.scheduler.enqueue(() => {
      try {
        task();
        result.resolve();
      } catch (error) {
        result.reject(error);
      }
    });
    return result.promise;
  }

  private unregister(): void {
    if (!this.registered) return;
    this.registered = false;
    this.context.unregisterEventSource(this);
  }

  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "EventSource",
      writable: false,
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(this, "length", {
      value: 1,
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}
