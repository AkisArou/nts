// The DOM ABI's own witness: identity, exceptions, exact text, stack
// rooting, listeners, frames, and the differential vectors, in one native
// callback the smoke runs. Every operation calls Blink immediately.
import * as testing from "nts:dom-testing";
import { asHTMLElement, cancelAnimationFrame, document, requestAnimationFrame } from "nts:dom";
import type { Document, Element, Event, Node } from "nts:dom";
import { idlTranscript } from "./idl-vectors.ts";
import { libDomTranscript } from "./lib-dom-vectors.ts";
import { startTimerVectors } from "./timer-vectors.ts";
import type { VectorHost } from "./idl-vectors.ts";

function element(d: Document, tag: string, id: string): Element {
  const node = d.createElement(tag);
  node.id = id;
  return node;
}

// What a call threw, as the program catches it: the DOMException's name and
// Blink's message, or "" when it did not throw.
function thrown(run: () => void): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

// The DOM ABI end to end in one callback, numbered so a failure names its
// step: node identity is the address, a DOM exception is thrown with Blink's
// own name and message, text crosses exactly both ways, a node only the
// native stack refers to survives a collection, and a compiled closure
// listens. Every member is the one generated from Blink's IDL.
export function ntsChromiumDomProgram(): number {
  const d = document();
  const body = d.querySelector("body");
  if (body === null) return 1;
  const container = element(d, "section", "native-dom");
  const label = element(d, "output", "native-dom-count");
  label.appendChild(d.createTextNode("Count: 0"));
  container.appendChild(label);
  body.appendChild(container);
  if (d.querySelector("#native-dom-count") !== label) return 2;
  if (d.querySelector("#missing") !== null) return 3;
  if (!thrown(() => d.querySelector("[")).startsWith("SyntaxError: ")) return 4;
  if (!thrown(() => container.appendChild(container)).startsWith("HierarchyRequestError: ")) return 5;
  if (!thrown(() => body.removeChild(label)).startsWith("NotFoundError: ")) return 6;
  if (!thrown(() => d.createElement("bad name")).startsWith("InvalidCharacterError: ")) return 7;

  // A string view must carry NUL, paired and lone surrogates, Latin-1 and
  // non-Latin-1 units into Blink, and the view Blink lends back must return
  // them, as text and as an attribute. A [Reflect]ed attribute reads through
  // Blink's own accessor.
  const exact = "A\0\u00e9\u03a9" + String.fromCharCode(0xd800) + "Z"
    + String.fromCharCode(0xdc00) + String.fromCharCode(0xd83d) + String.fromCharCode(0xde00);
  label.textContent = exact;
  if (label.textContent !== exact) return 8;
  label.setAttribute("data-exact", exact);
  if (label.getAttribute("data-exact") !== exact) return 9;
  label.className = "counter";
  if (label.className !== "counter" || label.getAttribute("class") !== "counter") return 9;

  // Detached, the label is referenced by nothing but this frame: no root, no
  // parent. A collection now is a conservative one, as an allocation would
  // trigger, and must find it on the stack.
  label.remove();
  if (d.querySelector("#native-dom-count") !== null) return 10;
  testing.nts_dom_collect_for_testing();
  if (label.textContent !== exact) return 11;
  container.appendChild(label);
  if (d.querySelector("#native-dom-count") !== label) return 12;

  // Events: a compiled closure on a button, fired synchronously by click(),
  // then removed, after which a click changes nothing. The closure captures
  // the button and the label, which are rooted while the listener holds it
  // and unrooted when removing it gives the closure back.
  const button = asHTMLElement(d.createElement("button"));
  if (button === null) return 13;
  const clicks = { count: 0 };
  const listener = button.listen("click", (event: Event): void => {
    if (event.target === button && event.type === "click") clicks.count += 1;
    label.textContent = "Clicked " + clicks.count;
  });
  button.click();
  button.click();
  if (clicks.count !== 2 || label.textContent !== "Clicked 2") return 14;
  listener.remove();
  listener.remove();
  button.click();
  if (clicks.count !== 2) return 16;

  // addEventListener as the DOM defines it: an equal listener -- same type,
  // capture and function -- is added once, and removeEventListener with the
  // same function takes it off.
  const added = { count: 0 };
  const onClick = (event: Event): void => {
    if (event.type === "click") added.count += 1;
  };
  button.addEventListener("click", onClick);
  button.addEventListener("click", onClick);
  button.click();
  if (added.count !== 1) return 17;
  button.removeEventListener("click", onClick);
  button.click();
  if (added.count !== 1) return 18;
  label.textContent = "Count: 0";

  // The differential vectors (idl-vectors.ts), whose transcript the oracle
  // page computes through V8's bindings: the DOM the smoke compares holds it.
  const narrowing: VectorHost = {
    failure: (error: unknown): string => (error as Error).message,
  };
  const vectors = d.createElement("section");
  container.appendChild(vectors);
  const transcript = idlTranscript(d, vectors, narrowing);
  const pre = element(d, "pre", "native-idl");
  pre.textContent = transcript;
  container.appendChild(pre);
  // The lib.dom vectors (lib-dom-vectors.ts), typed by lib.dom alone.
  const libDom = element(d, "pre", "native-lib-dom");
  libDom.textContent = libDomTranscript();
  container.appendChild(libDom);

  // The timer vectors (timer-vectors.ts): they run after this returns and
  // fill this transcript as they fire; the smoke waits for its data-done.
  container.appendChild(element(d, "pre", "native-timers"));
  startTimerVectors();

  // A frame callback runs before the next frame, with its time; a cancelled
  // one never runs. The smoke reads both after its frames have passed. The
  // first finds the label when it runs rather than capturing it, so nothing
  // is rooted when this callback returns (the observer logs roots=0).
  requestAnimationFrame((time: number): void => {
    const later = document().querySelector("#native-dom-count");
    if (later !== null) later.setAttribute("data-frame", time > 0 ? "ran" : "no time");
  });
  cancelAnimationFrame(requestAnimationFrame((): void => {
    label.setAttribute("data-cancelled", "ran");
  }));
  return 0;
}

export function ntsChromiumDomCounter(count: number): void {
  const label = document().querySelector("#native-dom-count");
  if (label !== null) label.textContent = "Count: " + count;
}
