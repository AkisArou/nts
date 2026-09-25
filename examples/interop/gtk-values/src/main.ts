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
//   temporary held gone  the same for a button that is never a local, made in
//                 `m.set`'s argument list: its own reference goes after the
//                 store, so the entry's is the last. `watch` alone passed while
//                 this failed -- `stash` routes around the shape by returning
//                 before the delete, and a fixture that avoids the shape
//                 cannot see it
//   dropped gone gone  a map, then an `unknown[]`, that dies holding a
//                 button's last reference gives it back (`alive alive` without
//                 counting). Before, a container's death visited only managed
//                 references, and a tagged handle is not one
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
// handle a name holds keeps its function's end. Deleting the entry then gives back the
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

// The same, for a button that is never a local: made in the argument list and
// only ever erased into the entry, as `m.set(k, new GtkButton())` is. Nothing on
// GTK's side can hold it without a count, so its own reference goes after the
// store, as ARC gives a temporary back at the end of its statement, and the
// entry's is the last. `watchEntry` reads the entry back in a call of its own,
// so that reading holds nothing past it.
function watchEntry(m: Map<string, GtkButton>, key: string): void {
  sub_watch(m.get(key)!);
}

function temporary(): string {
  const m = new Map<string, GtkButton>();
  m.set("t", new GtkButton());
  watchEntry(m, "t");
  // Both read before any branch: a branch ends the block, and a foreign
  // handle's release waits for its block's end, so a branch here would give
  // the button back before the delete whatever the rule.
  const early = sub_gone();
  m.delete("t");
  const gone = sub_gone();
  return (early ? "early" : "held") + " " + (gone ? "gone" : "alive");
}

// A container that dies holding a button's last reference gives it back: a
// map, and an `unknown[]`, each gone when its function returns. The button
// is watched through the container, so no local holds it past the return.
function dropMap(): void {
  const m = new Map<string, GtkButton>();
  m.set("d", new GtkButton());
  watchEntry(m, "d");
}

function dropArray(): void {
  const xs: unknown[] = [];
  xs.push(new GtkButton());
  const first = xs[0];
  if (first instanceof GtkButton) sub_watch(first);
}

function dropped(): string {
  dropMap();
  const map = sub_gone() ? "gone" : "alive";
  dropArray();
  return map + " " + (sub_gone() ? "gone" : "alive");
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
  sub_log("temporary " + temporary());
  sub_log("dropped " + dropped());
}

main();
