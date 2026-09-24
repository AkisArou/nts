// The nts half of the GTK benchmark against GJS; `../gjs/bench.js` is the
// other, line for line. `BENCH_CASE` picks one case per process, and each
// prints `<case> <ns per operation>`: the best of three timed runs after one
// untimed, which GJS's JIT needs and nts does not.
import { gtk_init, GtkAdjustment, GtkApplication, GtkButton, GtkLabel, GtkWindow } from "c:Gtk-4.0";
import { ApplicationFlags } from "c:Gio-2.0";
import { bench_case, bench_log, bench_now } from "c:bench";
import type { c_double } from "c:types";

function best(name: string, n: number, run: (n: number) => void): void {
  run(n);
  let fastest = Infinity;
  for (let rep = 0; rep < 3; rep++) {
    const start = bench_now() as number;
    run(n);
    const took = (bench_now() as number) - start;
    if (took < fastest) fastest = took;
  }
  bench_log(name + " " + (fastest * 1e6 / n).toFixed(1));
}

// A signal's round trip: out to GTK, and back to a handler. A new value
// emits `value-changed` synchronously; a button's `activate` animates first.
function signal(): void {
  const adjustment = new GtkAdjustment({ upper: 1e12 as c_double });
  let changes = 0;
  let value = 0;
  adjustment.connect("value-changed", () => {
    changes++;
  });
  best("signal", 500000, (n) => {
    for (let i = 0; i < n; i++) adjustment.set_value(++value as c_double);
  });
  if (changes !== 500000 * 4) bench_log("signal: wrong count " + String(changes));
}

// A property written and read back.
function property(): void {
  const label = new GtkLabel({ label: "a" });
  let length = 0;
  best("property", 500000, (n) => {
    for (let i = 0; i < n; i++) {
      label.label = (i & 1) === 0 ? "a" : "bb";
      length += label.label.length;
    }
  });
  if (length === 0) bench_log("property: nothing read");
}

// Construction with a property, and the object let go.
function construct(): void {
  best("construct", 100000, (n) => {
    for (let i = 0; i < n; i++) {
      const label = new GtkLabel({ label: "x" });
      if (label.label.length !== 1) bench_log("construct: wrong label");
    }
  });
}

// An inherited method that does almost nothing.
function method(): void {
  const button = new GtkButton({ label: "x" });
  let visible = 0;
  best("method", 2000000, (n) => {
    for (let i = 0; i < n; i++) if (button.get_visible()) visible++;
  });
  if (visible === 0) bench_log("method: never visible");
}

// Startup to a mapped window, timed from outside the process.
function startup(): void {
  const application = new GtkApplication({ application_id: "dev.nts.Bench", flags: ApplicationFlags.NON_UNIQUE });
  application.connect("activate", () => {
    const window = new GtkWindow({ title: "bench" });
    window.connect("map", () => {
      application.quit();
    });
    application.add_window(window);
    window.present();
  });
  application.run(["bench"]);
}

function main(): void {
  const name = bench_case();
  if (name === "startup") {
    startup();
    return;
  }
  gtk_init();
  if (name === "signal") signal();
  else if (name === "property") property();
  else if (name === "construct") construct();
  else if (name === "method") method();
  else bench_log("unknown case: " + name);
}

main();
