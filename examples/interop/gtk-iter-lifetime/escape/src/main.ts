// The case block-end release does not fix: the iterator ESCAPES the block that
// owns its buffer. `startOf` returns an iterator into a buffer nothing names
// once it returns, so a release at the end of `startOf`'s block frees the
// buffer as surely as a release at its last use does.
//
// This is not the compiler's to fix without counting what GTK does not:
// GTK's contract is that the caller keeps the buffer alive, and GJS breaks
// here too, once a collection runs. It is here so the gap has a witness:
// `build.sh` expects this product to FAIL under `--rc`, and says so when it
// starts passing (fixed, or the check went blind).
import { GtkTextBuffer, GtkTextIter } from "c:Gtk-4.0";
import { sub_log } from "c:sub";

function startOf(text: string): GtkTextIter {
  const buffer = new GtkTextBuffer({});
  buffer.set_text(text, -1);
  const start = new GtkTextIter();
  const end = new GtkTextIter();
  buffer.get_bounds(start, end);
  return start;
}

function main(): void {
  const start = startOf("hello world");
  start.forward_chars(6);
  sub_log("escape " + String(start.get_offset()) + " " + String(start.get_char()));
}

main();
