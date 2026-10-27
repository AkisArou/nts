// expect: emit-c --napi -> no wrapper for dispatched -- `nts check` on this
// program ends "the backend declined 6 function(s)": the two
// `streams/fifo.ts` object types with no layout, the signatures of
// `ReadableByteStreamHost` and `ReadableStreamBYOBHost`, and
// `CookieJarStore#saveAll` with `CookieJar#save`. Importing `core/events`
// pulls those in through `abort.ts` and `provider/environment.ts`, so no
// program using `EventTarget` emits at all today. Two exports are refused
// nearer home as well: `dispatched` for the `weakResource` union property
// on listener records, and `constants` because `Event`'s constructor calls
// `Object.defineProperty` for `isTrusted`. `domException` already compiles.
// When this reports FIXED, move the fixture to `tests/programs`, where it
// was written to live: it then pins the split described below.
//
// The web-platform classes at work without their Web IDL surface shape: an
// `EventTarget` a listener is added to and an `Event` dispatched at, the
// phase constants on `Event` itself, and a `DOMException` by name and code.
// The reflective setup the classes carry (prototype descriptors,
// `Symbol.toStringTag`, constructor length) lives in module-level statements
// after each class, refused by this compiler and cut there (NTS1005); what
// this case will pin, once it can compile, is that the cut stops there --
// the class, its functional static initialization and its constants still
// compile and answer as node does, which runs the same sources.
import { Event, EventTarget } from "../../../../runtime/web-platform/src/core/events.ts";
import { DOMException } from "../../../../runtime/web-platform/src/core/errors.ts";
import { WebSocket } from "../../../../runtime/web-platform/src/websocket/websocket.ts";

export function dispatched(seed: number): string {
  const target = new EventTarget();
  const calls: string[] = [];
  target.addEventListener("ping", (event) => {
    calls.push(event.type + ":" + String(event.eventPhase));
  });
  target.addEventListener(
    "ping",
    () => {
      calls.push("once");
    },
    { once: true },
  );
  const event = new Event("ping", { bubbles: true, cancelable: true });
  const first = target.dispatchEvent(event);
  const second = target.dispatchEvent(new Event("ping"));
  const other = target.dispatchEvent(new Event("pong"));
  return (
    calls.join(",") +
    "|" +
    String(first) +
    String(second) +
    String(other) +
    "|" +
    String(event.bubbles) +
    String(event.cancelable) +
    "|" +
    String((seed | 0) & 1)
  );
}

export function constants(seed: number): number {
  const event = new Event("x");
  return (
    Event.NONE * 1000 +
    Event.CAPTURING_PHASE * 100 +
    Event.AT_TARGET * 10 +
    Event.BUBBLING_PHASE +
    event.eventPhase +
    ((seed | 0) & 1)
  );
}

// The Web IDL constants read off an instance and off the class, plus the
// comparison the state machine itself runs on. The instance values come
// from prototype getters on the class; the reflective loop that would
// redefine them as data properties is cut, so this pins that the values
// survive the cut. The socket arrives as a parameter because constructing
// one needs an installed platform runtime, which no fixture here has.
export function socketConstants(socket: WebSocket, seed: number): number {
  return (
    socket.CONNECTING * 100000 +
    socket.OPEN * 10000 +
    socket.CLOSING * 1000 +
    socket.CLOSED * 100 +
    WebSocket.CONNECTING * 10000 +
    WebSocket.OPEN * 1000 +
    WebSocket.CLOSING * 100 +
    WebSocket.CLOSED * 10 +
    (socket.readyState === socket.CONNECTING ? 1 : 0) +
    ((seed | 0) & 1)
  );
}

export function domException(seed: number): string {
  const error = new DOMException("The operation was aborted", "AbortError");
  return (
    error.name +
    "|" +
    error.message +
    "|" +
    String(error.code) +
    "|" +
    String(DOMException.ABORT_ERR) +
    "|" +
    String(error.ABORT_ERR) +
    "|" +
    String(error instanceof Error) +
    "|" +
    String((seed | 0) & 1)
  );
}
