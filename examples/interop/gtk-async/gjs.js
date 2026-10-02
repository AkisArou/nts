// The same program under GJS, the order gtk-async's log is compared with:
//   gjs -m gjs.js
import GLib from "gi://GLib";
import Gtk from "gi://Gtk?version=4.0";

async function tick() {
  await 0;
}

function fail() {
  return Promise.reject(new Error("boom"));
}

Gtk.init();
const loop = GLib.MainLoop.new(null, false);
const button = new Gtk.Button({ label: "b" });
const log = [];
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

const failing = new Gtk.Button({ label: "f" });
failing.connect("clicked", async () => {
  await fail().catch((error) => {
    log.push("caught " + (error instanceof Error ? error.message : "?"));
  });
});

GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
  button.emit("clicked");
  log.push("emitted");
  return false;
});
GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
  failing.emit("clicked");
  return false;
});
GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
  print(log.join(" "));
  loop.quit();
  return false;
});
loop.run();
