// Cycles through a GObject, under reference counting.
//
// `label.connect("destroy", () => label.set_label(…))` is a closure holding the
// label and a label holding the closure -- a foreign object in the middle,
// which a collector of the program's own objects cannot see through. The
// runtime's `NtsHolders` makes a GObject that holds a lent closure a node of
// the trace, counted by its own `ref_count`; each arm below counts
// finalizations a timer's worth of loop later, by which time a checkpoint has
// collected.
//
// The log, in order:
//   plain 1       a label nothing else holds (the control that counting works)
//   other 1       its handler captures another label, so there is no cycle
//   itself 1      its handler captures itself: the cycle, collected
//   parented 1    the same inside a window, then destroyed. GTK drops its
//                 reference to the child on its own side, releasing nothing of
//                 ours, and the collector notices because the count fell
//   h1 e          the first of two handlers, mid-emission, drops every
//                 reference outside the cycle but the emission's own
//   h2 e looked   the second still runs, and a collection examined the label
//                 between the two (`looked`): the emission's references are
//                 real ones, and they kept it
//   emitting 1    and once the emission ended, it was collected
//   chained 2     A's cycle is the last to hold B: both go, B inside the
//                 sweep. B's own handler does not run on the way out -- it is
//                 garbage with B, and severed first
//   listed 3      three labels in an array, each handler capturing the
//                 array: the trace goes through the array's elements
import { gtk_init, GtkLabel, GtkWindow } from "c:Gtk-4.0";
import {
  cycles_candidates,
  cycles_drop,
  cycles_emit_later,
  cycles_finalized,
  cycles_log,
  cycles_track,
} from "c:cycles";

function plain(): void {
  const label = new GtkLabel({ label: "a" });
  cycles_track(label);
}

function other(): void {
  const keeper = new GtkLabel({ label: "k" });
  const label = new GtkLabel({ label: "b" });
  cycles_track(label);
  label.connect("destroy", () => {
    keeper.set_label("x");
  });
}

function itself(): void {
  const label = new GtkLabel({ label: "c" });
  cycles_track(label);
  label.connect("destroy", () => {
    label.set_label("y");
  });
}

function parented(): void {
  const window = new GtkWindow({ title: "p" });
  const label = new GtkLabel({ label: "d" });
  cycles_track(label);
  label.connect("destroy", () => {
    label.set_label("z");
  });
  window.set_child(label);
  window.destroy();
}

function emitting(): void {
  const label = new GtkLabel({ label: "e" });
  cycles_track(label);
  let seen: bigint = 0n;
  label.connect("notify", () => {
    cycles_drop();
    seen = cycles_candidates();
    cycles_log("h1 " + label.get_label());
  });
  label.connect("notify", () => {
    const looked = cycles_candidates() > seen ? "looked" : "unlooked";
    cycles_log("h2 " + label.get_label() + " " + looked);
  });
  cycles_emit_later(label);
}

function chained(): void {
  const b = new GtkLabel({ label: "b" });
  cycles_track(b);
  b.connect("destroy", () => {
    cycles_log("b destroyed");
  });
  const a = new GtkLabel({ label: "a" });
  cycles_track(a);
  a.connect("destroy", () => {
    a.set_label(b.get_label());
  });
}

function listed(): void {
  const rows: GtkLabel[] = [];
  for (let at = 0; at < 3; at++) {
    const row = new GtkLabel({ label: "r" });
    cycles_track(row);
    row.connect("destroy", () => {
      rows[0].set_label("z");
    });
    rows.push(row);
  }
}

// A timer's worth of loop: long enough for GLib's idle sources to run too.
function turn(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, 20);
  });
}

async function arm(name: string, run: () => void, turns: number): Promise<void> {
  const before = cycles_finalized() as number;
  run();
  for (let at = 0; at < turns; at++) {
    await turn();
  }
  cycles_log(name + " " + String((cycles_finalized() as number) - before));
}

async function main(): Promise<void> {
  gtk_init();
  await arm("plain", plain, 1);
  await arm("other", other, 1);
  await arm("itself", itself, 1);
  await arm("parented", parented, 1);
  await arm("emitting", emitting, 2);
  await arm("chained", chained, 1);
  await arm("listed", listed, 1);
}

void main();
