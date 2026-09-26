// A GtkTextIter points into its buffer without counting it -- GTK's contract
// is that the caller keeps the buffer alive -- and the program's name for the
// buffer is still in scope after its last use here. GJS keeps the buffer while
// it is reachable; under `--rc`, a release at the buffer's last use frees it
// before the iterators are read, and GTK reports an invalid iterator (a
// critical under `G_DEBUG=fatal-warnings`).
//
// The ORDER is the test: `buffer`'s last use is `get_text`, and the iterators
// are used after it. Naming `buffer` again anywhere below would hide the bug.
//
// **A recorded gap under `--rc`**: `build.sh` expects that arm to fail until
// foreign handles are released at block end, and fails if it passes before.
import { GtkTextBuffer, GtkTextIter } from "c:Gtk-4.0";

function main(): void {
  const buffer = new GtkTextBuffer({});
  buffer.set_text("hello world", -1);
  const start = new GtkTextIter();
  const end = new GtkTextIter();
  buffer.get_bounds(start, end);
  const all = buffer.get_text(start, end, false);
  start.forward_chars(6);
  console.log("lifetime " + all + " " + String(start.get_offset()) + " " + String(end.get_offset()));
}

main();
