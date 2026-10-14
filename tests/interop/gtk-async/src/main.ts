// Async signal handlers, as GJS writes them: `button.connect("clicked",
// async () => { ... await ... })`. A program whose loop is GLib's checkpoints
// when a callback returns to that loop (`nts_checkpoint_after_callbacks`), so
// a handler runs to its first `await` inside the emission and the rest when
// the callback that emitted returns to GLib.
//
// The log, in order:
//
//   direct c1 after c2  one emitted from module code: it runs to its `await`,
//                 and the module code after the emission runs before its
//                 continuation, as a script runs to completion first; the
//                 continuation runs at the loop's first turn
//   a1 b1 emitted a2 b2  two async handlers emitted from an idle callback:
//                 each runs to its `await`, the emission returns, and their
//                 continuations run when the idle callback returns to GLib
//   caught boom   a rejection handled by the handler's own `.catch`
//
// Against GJS (gjs.js beside this file, `gjs -m gjs.js`): the same steps in
// the same order, `direct c1 after c2 a1 b1 emitted` and then `a2 b2`. GJS runs its job queue
// from an idle source of its own, so its continuations come after every idle
// already queued -- after the one printing the log -- where these run as the
// callback returns, as node's do after a macrotask.
import { Button, init } from "gi:gtk";
import { idleAdd, MainLoop, PRIORITY_DEFAULT } from "gi:glib";

async function tick(): Promise<void> {
  await 0;
}

function fail(): Promise<void> {
  return Promise.reject(new Error("boom"));
}

init();
const loop = MainLoop.new(null, false);
const button = new Button({ label: "b" });
const log: string[] = [];
button.connect("clicked", async () => {
  log.push("a1");
  await tick();
  log.push("a2");
});
button.connect("clicked", async () => {
  log.push("b1");
  await tick();
  log.push("b2");
});

const direct = new Button({ label: "d" });
direct.connect("clicked", async () => {
  log.push("c1");
  await tick();
  log.push("c2");
});
const failing = new Button({ label: "f" });
failing.connect("clicked", async () => {
  await fail().catch((error: unknown) => {
    log.push("caught " + (error instanceof Error ? error.message : "?"));
  });
});

log.push("direct");
direct.emit("clicked");
log.push("after");

idleAdd(PRIORITY_DEFAULT, () => {
  button.emit("clicked");
  log.push("emitted");
  return false;
});
idleAdd(PRIORITY_DEFAULT, () => {
  failing.emit("clicked");
  return false;
});
idleAdd(PRIORITY_DEFAULT, () => {
  console.log(log.join(" "));
  loop.quit();
  return false;
});
loop.run();
