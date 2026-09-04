// `node:http`, from node v24.20.0 `lib/http.js`.
//
// The parser is this profile's own -- node's is llhttp, a C library -- so what
// is here is a complete HTTP/1.1 implementation rather than a wrapper around
// one. That makes this the module whose conformance numbers say the most: a
// passing test is this code parsing and framing, not somebody else's.

import { HTTPParser, methods } from "./parser.ts";
import { IncomingMessage } from "./incoming.ts";
import { OutgoingMessage, ServerResponse } from "./outgoing.ts";
import { Server, createServer } from "./server.ts";
import { Agent, globalAgent } from "./agent.ts";
import { ClientRequest, get, request } from "./client.ts";
import { STATUS_CODES } from "./status.ts";

export {
  Agent,
  ClientRequest,
  HTTPParser,
  IncomingMessage,
  OutgoingMessage,
  Server,
  ServerResponse,
  STATUS_CODES,
  createServer,
  get,
  globalAgent,
  methods,
  request,
};

/** The maximum size of a request head, in bytes, unless a server overrides it. */
export const maxHeaderSize = 80 * 1024;
