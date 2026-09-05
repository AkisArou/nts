// `node:http`, from node v24.20.0 `lib/http.js`.
//
// The parser is this profile's own -- node's is llhttp, a C library -- so what
// is here is a complete HTTP/1.1 implementation rather than a wrapper around
// one. That makes this the module whose conformance numbers say the most: a
// passing test is this code parsing and framing, not somebody else's.

import {
  DEFAULT_MAX_HEADER_SIZE,
  HTTPParser,
  METHODS,
  methods,
  setHTTPParserPoolLimit,
} from "./parser.ts";
import { IncomingMessage } from "./incoming.ts";
import {
  checkInvalidHeaderChar,
  checkIsHttpToken,
  OutgoingMessage,
  ServerResponse,
  validateHeaderName,
  validateHeaderValue,
} from "./outgoing.ts";
import { Server, createServer } from "./server.ts";
import { Agent, globalAgent } from "./agent.ts";
import { ClientRequest, get, request } from "./client.ts";
import { STATUS_CODES } from "./status.ts";
import { validateInteger } from "../../internal/validators.ts";
import type { Blob } from "../../buffer/src/blob.ts";
import type { URL } from "../../url/src/url.ts";

interface WebEvent {
  readonly type: string;
}

interface WebCloseEvent extends WebEvent {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
}

interface WebMessageEvent<T = unknown> extends WebEvent {
  readonly data: T;
  readonly lastEventId: string;
  readonly origin: string;
  readonly ports: readonly object[];
  readonly source: object | null;
}

interface WebSocketEventMap {
  close: WebCloseEvent;
  error: WebEvent;
  message: WebMessageEvent;
  open: WebEvent;
}

interface WebSocketInstance {
  binaryType: "blob" | "arraybuffer";
  readonly bufferedAmount: number;
  readonly extensions: string;
  readonly protocol: string;
  readonly readyState: number;
  readonly url: string;
  onclose: ((this: WebSocketInstance, event: WebCloseEvent) => unknown) | null;
  onerror: ((this: WebSocketInstance, event: WebEvent) => unknown) | null;
  onmessage: ((this: WebSocketInstance, event: WebMessageEvent) => unknown) | null;
  onopen: ((this: WebSocketInstance, event: WebEvent) => unknown) | null;
  addEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: WebSocketInstance, event: WebSocketEventMap[K]) => unknown,
    options?: boolean | { capture?: boolean; once?: boolean; passive?: boolean },
  ): void;
  removeEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: WebSocketInstance, event: WebSocketEventMap[K]) => unknown,
    options?: boolean | { capture?: boolean },
  ): void;
  close(code?: number, reason?: string): void;
  send(data: string | ArrayBufferLike | ArrayBufferView<ArrayBufferLike> | Blob): void;
}

interface WebSocketConstructor {
  readonly prototype: WebSocketInstance;
  new (url: string | URL, protocols?: string | string[]): WebSocketInstance;
  readonly CLOSED: 3;
  readonly CLOSING: 2;
  readonly CONNECTING: 0;
  readonly OPEN: 1;
}

interface WebEventInit {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
}

interface WebCloseEventInit extends WebEventInit {
  code?: number;
  reason?: string;
  wasClean?: boolean;
}

interface WebCloseEventConstructor {
  readonly prototype: WebCloseEvent;
  new (type: string, init?: WebCloseEventInit): WebCloseEvent;
}

interface WebMessageEventInit<T> extends WebEventInit {
  data?: T;
  lastEventId?: string;
  origin?: string;
  ports?: object[];
  source?: object | null;
}

interface WebMessageEventConstructor {
  readonly prototype: WebMessageEvent;
  new <T>(type: string, init?: WebMessageEventInit<T>): WebMessageEvent<T>;
}

declare global {
  var CloseEvent: WebCloseEventConstructor;
  var MessageEvent: WebMessageEventConstructor;
  var WebSocket: WebSocketConstructor;
}

// Node exposes the same constructors through `node:http` and the Web globals.
// Keep the references themselves: wrapping a constructor would break identity,
// static members, and `instanceof` while adding a call on every construction.
export const CloseEvent = globalThis.CloseEvent;
export const MessageEvent = globalThis.MessageEvent;
export const WebSocket = globalThis.WebSocket;

export function setMaxIdleHTTPParsers(max: number): void {
  validateInteger(max, "max", 1);
  setHTTPParserPoolLimit(max);
}

export {
  Agent,
  ClientRequest,
  HTTPParser,
  IncomingMessage,
  METHODS,
  OutgoingMessage,
  Server,
  ServerResponse,
  STATUS_CODES,
  checkInvalidHeaderChar,
  checkIsHttpToken,
  createServer,
  get,
  globalAgent,
  methods,
  request,
  validateHeaderName,
  validateHeaderValue,
  DEFAULT_MAX_HEADER_SIZE as maxHeaderSize,
};
