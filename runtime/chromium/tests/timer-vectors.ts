// Differential vectors for the program's timers. The DOM witness starts them
// after its synchronous checks; the oracle page runs this same source, types
// stripped, with the browser's own setTimeout. Each callback appends to
// `<pre id="native-timers">` and the last one sets `data-done`, which the
// smoke waits for before it reads the page. Nothing here keeps a node: each
// callback finds the transcript when it runs, and an interval keeps its id
// and count in attributes, so no handle is rooted while the timers wait.
import { asHTMLElement, clearInterval, clearTimeout, document, setInterval, setTimeout } from "nts:dom";
import type { Event } from "nts:dom";

function log(text: string): void {
  const pre = document().querySelector("#native-timers");
  if (pre === null) return;
  const before = pre.textContent;
  pre.textContent = (before === null ? "" : before) + text + ";";
}

function attribute(name: string): number {
  const pre = document().querySelector("#native-timers");
  if (pre === null) return -1;
  const value = pre.getAttribute(name);
  return value === null ? -1 : Number(value);
}

function remember(name: string, value: number): void {
  const pre = document().querySelector("#native-timers");
  if (pre !== null) pre.setAttribute(name, String(value));
}

// A listener that removes itself while it runs, armed here and clicked from a
// timer -- a later entry, when nothing but the listener holds the closure, as
// in an app whose setup has returned. It must run once, and still read what
// it captured after the removal: the closure may go back only once its own
// run returns.
function armSelfRemoval(): void {
  remember("data-self-removal", 0);
  const button = document().createElement("button");
  button.id = "self-removal";
  const body = document().body;
  if (body !== null) body.appendChild(button);
  // Captured, and read after the removal: a number computed at run time, so
  // it lives in the closure's own environment and nothing else.
  const salt = button.id.length;
  function once(event: Event): void {
    const target = event.currentTarget;
    if (target !== null) target.removeEventListener("click", once);
    const runs = attribute("data-self-removal") + 1;
    remember("data-self-removal", runs);
    log("selfRemoval" + runs + "kept" + salt);
  }
  button.addEventListener("click", once);
}

// An event handler that clears itself while it runs (`el.onclick = null`
// inside it): nothing but the handler slot holds that closure, so it must not
// go back before its run returns.
function armSelfClearingHandler(): void {
  remember("data-self-clearing", 0);
  const button = asHTMLElement(document().createElement("button"));
  if (button === null) return;
  button.id = "self-clearing";
  const body = document().body;
  if (body !== null) body.appendChild(button);
  const salt = button.id.length;
  button._set_onclick_void((event: Event): void => {
    const target = event.currentTarget;
    if (target !== null) {
      const found = document().querySelector("#self-clearing");
      const self = found === null ? null : asHTMLElement(found);
      if (self !== null) self._set_onclick_null();
    }
    const runs = attribute("data-self-clearing") + 1;
    remember("data-self-clearing", runs);
    log("selfClearing" + runs + "kept" + salt);
  });
}

function clickSelfRemoval(): void {
  const found = document().querySelector("#self-removal");
  if (found === null) return;
  const button = asHTMLElement(found);
  if (button === null) return;
  button.click();
  button.click();
  button.remove();
  const handled = document().querySelector("#self-clearing");
  if (handled === null) return;
  const clearing = asHTMLElement(handled);
  if (clearing === null) return;
  clearing.click();
  clearing.click();
  clearing.remove();
}

// Three phases, each started by the one before, so no ordering in the
// transcript rests on how two timers due at nearby times race.
export function startTimerVectors(): void {
  armSelfRemoval();
  armSelfClearingHandler();
  // Order by delay, then by when they were set: a negative or NaN timeout
  // is 0, and a 0 runs before a 5 and a 20.
  setTimeout((): void => { log("t20"); intervals(); }, 20);
  setTimeout((): void => { log("t5"); }, 5);
  setTimeout((): void => { log("t0"); clickSelfRemoval(); }, 0);
  setTimeout((): void => { log("tNegative"); }, -5);
  setTimeout((): void => { log("tNaN"); }, 0 / 0);
  setTimeout((): void => { log("tDefault"); });

  // Cleared before it is due: never runs.
  clearTimeout(setTimeout((): void => { log("cleared"); }, 0));
  // clearTimeout stops an interval: HTML clears both from one list.
  clearTimeout(setInterval((): void => { log("intervalClearedByTimeout"); }, 1));
  // An unknown id clears nothing.
  clearInterval(987654);
}

// An interval that clears itself from inside its third run, then nests.
function intervals(): void {
  remember("data-ticks", 0);
  const interval = setInterval((): void => {
    const ticks = attribute("data-ticks") + 1;
    remember("data-ticks", ticks);
    log("tick" + ticks);
    if (ticks === 3) {
      clearInterval(attribute("data-interval"));
      nested();
    }
  }, 2);
  remember("data-interval", interval);
  log("ids" + (interval > 0 ? "+" : "-"));
}

// A timer set from inside a timer runs after it, in a later task; ten deep,
// past the nesting level where HTML clamps a 0 to 4 ms, still in order.
function nested(): void {
  remember("data-depth", 0);
  setTimeout(deeper, 0);
}

function deeper(): void {
  const depth = attribute("data-depth") + 1;
  remember("data-depth", depth);
  log("depth" + depth);
  if (depth < 10) {
    setTimeout(deeper, 0);
    return;
  }
  // A last one after a quiet interval: the interval is gone by now.
  setTimeout((): void => {
    log("done" + attribute("data-ticks"));
    remember("data-done", 1);
  }, 20);
}
