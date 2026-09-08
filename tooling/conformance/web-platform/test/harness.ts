// Narrowings this suite needs in many places, written once.
//
// Each of these exists because a value is legitimately wider than the tests use it as, and the
// honest way to close that gap is a check rather than an assertion that it cannot happen. Three
// of them recurred often enough that a local copy per file was the worse option: a helper that
// exists twice is a helper that drifts, and here it would drift in what it is willing to accept.
import assert from "node:assert/strict";
import type { Server } from "node:net";

import { MessageEvent } from "../../../../runtime/web-platform/src/index.ts";
import type { Event } from "../../../../runtime/web-platform/src/index.ts";

/**
 * The port a listening TCP server bound.
 *
 * `address()` is a union: a string for a pipe, `null` before the socket is bound. A server that
 * has emitted `listening` over TCP is always the object form, and checking says so where a
 * non-null assertion would only have claimed it.
 */
export function portOf(server: Server): number {
  const address = server.address();
  assert.ok(
    address !== null && typeof address === "object",
    "expected a listening TCP server with a bound port",
  );
  return address.port;
}

/**
 * An error's cause chain, flattened to one string.
 *
 * Every link is `unknown` -- `cause` is declared that way and a thrown value need not be an
 * Error at all -- so each step reads defensively rather than assuming a shape. Fetch reports
 * every failure as an opaque `TypeError: Network request failed`, which is why the reason a
 * test is actually looking for lives down here.
 */
export function causeText(from: unknown): string {
  let cause: unknown = from;
  let text = "";
  while (cause !== undefined && cause !== null) {
    const message: unknown = (cause as { message?: unknown }).message;
    text += String(message ?? cause) + " ";
    cause = (cause as { cause?: unknown }).cause;
  }
  return text;
}

/**
 * The payload of a message event.
 *
 * `addEventListener` hands its listener the base `Event`, because one signature serves every
 * type. A message event carries `data`, and this narrows to it rather than the field being read
 * off a type that does not declare it.
 */
export function messageData(event: Event): unknown {
  assert.ok(event instanceof MessageEvent, "expected a MessageEvent");
  return event.data;
}
