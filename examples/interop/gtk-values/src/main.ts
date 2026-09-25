// GTK handles held where any value may go -- an `unknown`, an `unknown[]`, a
// `Map` -- as the handle tag block carries them: the value's tag is the
// object system (`NTS_TAG_HANDLE_GOBJECT`), its payload the `GObject *`, and a
// value that holds one owns one reference, counted through GObject's
// registration. Read back where the program narrowed it, and checked there.
//
// The log:
//   button b|button b  a button passed as `unknown` and narrowed back by
//                 `instanceof GtkButton`, directly and out of an `unknown[]`
//   number|label  the array's other elements, told apart by the same tests
//   object        `typeof` of a handle, as GJS answers
//   true|true     identity: the array's element and the map's value are the
//                 button itself (`=== b`), where a box would be another object
//   true|b        a key the map does not have is `undefined`; one it has reads
//                 back the button's own label
//   kept ac 3     a map written, overwritten, deleted from and cleared, with one
//                 button under two keys, and an array emptied: the button a map
//                 key still held survives all of it, and so do both buttons
//   walked ...    the map walked by `for...of`, its entries and its values: each
//                 value read back as the button it is
//   watch held gone  under `--rc`: a button a map's entry was the last to
//                 hold is still there after its maker returned, and finalized
//                 when the entry is deleted (`held alive` without counting,
//                 where nothing is released)
import { GtkButton, GtkLabel, gtk_init } from "c:Gtk-4.0";
import { sub_gone, sub_log, sub_watch } from "c:sub";

function describe(x: unknown): string {
  if (x instanceof GtkButton) return "button " + (x.label ?? "");
  if (x instanceof GtkLabel) return "label";
  return typeof x;
}

function churn(): string {
  const a = new GtkButton({ label: "a" });
  const c = new GtkButton({ label: "c" });
  const m = new Map<string, GtkButton>();
  for (let i = 0; i < 50; i++) {
    m.set("k" + String(i % 5), i % 2 === 0 ? a : c);
    m.set("same", a);
    m.set("twin", a);
  }
  m.delete("k1");
  const kept = m.get("twin");
  m.clear();
  const bag: unknown[] = [];
  for (let i = 0; i < 20; i++) bag.push(i % 3 === 0 ? a : c);
  bag.length = 3;
  return (kept === a ? "kept " : "lost ") + (a.label ?? "") + (c.label ?? "") + " " + String(bag.length);
}

// A button whose only holder is a map's entry: `stash` makes it, watches it and
// stores it, and its own reference goes when `stash` returns -- a foreign
// handle keeps its function's end. Deleting the entry then gives back the
// last reference, so under reference counting the button is finalized there:
// the entry owned one reference, no more and no fewer.
function stash(m: Map<string, GtkButton>): void {
  const watched = new GtkButton({ label: "w" });
  sub_watch(watched);
  m.set("k", watched);
}

function released(): string {
  const m = new Map<string, GtkButton>();
  stash(m);
  const before = sub_gone() ? "early" : "held";
  m.delete("k");
  return before + " " + (sub_gone() ? "gone" : "alive");
}

function main(): void {
  gtk_init();
  const b = new GtkButton({ label: "b" });
  const bag: unknown[] = [b, 1, "s", new GtkLabel({})];
  const byName = new Map<string, GtkButton>();
  byName.set("one", b);
  byName.set("also", b);
  const got = byName.get("one");
  const missing = byName.get("none");
  sub_log(
    [
      describe(b),
      describe(bag[0]),
      describe(bag[1]),
      describe(bag[3]),
      typeof bag[0],
      String(bag[0] === b),
      String(got === b),
      String(missing === undefined),
      got !== undefined ? (got.label ?? "") : "?",
    ].join("|"),
  );
  sub_log(churn());
  // Walked, entry by entry: each value read back as the button it is.
  let walked = "";
  for (const [name, button] of byName) walked += name + "=" + (button.label ?? "") + " ";
  for (const button of byName.values()) walked += button === b ? "same " : "other ";
  sub_log("walked " + walked.trim());
  sub_log("watch " + released());
}

main();
