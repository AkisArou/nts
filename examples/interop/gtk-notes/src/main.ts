// A notes application, written as GJS would write it: a window with an entry,
// an Add button and a list; notes loaded from a file when it opens, and the
// file written back after each one added. It drives itself -- three notes
// typed and added, then it quits -- so `build.sh` can run it twice and check
// that the second run finds what the first saved.
//
// The log, in order:
//   loaded N      the notes read from the file, a line each, through
//                 `read_async` and a `GDataInputStream` (0 on the first run)
//   added T       each note typed into the entry and added by the button's
//                 `clicked` handler, which reads `entry.text` -- `GtkEditable`'s
//                 property on a `GtkEntry` -- and clears it
//   count N notes the status label, kept by the same handler
//   saved N       the file written back through `replace_async` and a
//                 `GDataOutputStream`, awaited
import {
  GtkApplication,
  GtkApplicationWindow,
  GtkBox,
  GtkButton,
  GtkEntry,
  GtkLabel,
  GtkListBox,
  Orientation,
} from "c:Gtk-4.0";
import { ApplicationFlags, FileCreateFlags, g_data_input_stream_new, g_data_output_stream_new, g_file_new_for_path, type GFile } from "c:Gio-2.0";
import { notes_emit, notes_log } from "c:notes";

const PATH = "/tmp/nts-gtk-notes.txt";

async function load(file: GFile): Promise<string[]> {
  const notes: string[] = [];
  try {
    const lines = g_data_input_stream_new(await file.read_async());
    for (let [line] = lines.read_line_utf8(); line !== null; [line] = lines.read_line_utf8()) {
      if (line.length > 0) notes.push(line);
    }
  } catch {
    // No file yet: an empty list.
  }
  return notes;
}

async function save(file: GFile, notes: string[]): Promise<void> {
  const out = g_data_output_stream_new(await file.replace_async(null, false, FileCreateFlags.NONE));
  for (const note of notes) out.put_string(note + "\n");
  out.close();
}

class Notes {
  readonly notes: string[] = [];
  readonly file: GFile;
  readonly list: GtkListBox;
  readonly status: GtkLabel;

  constructor(file: GFile, list: GtkListBox, status: GtkLabel) {
    this.file = file;
    this.list = list;
    this.status = status;
  }

  show(note: string): void {
    this.notes.push(note);
    this.list.append(new GtkLabel({ label: note, xalign: 0 }));
    this.status.label = String(this.notes.length) + " notes";
  }
}

async function open(application: GtkApplication): Promise<void> {
  const window = new GtkApplicationWindow({ application, title: "Notes" });
  window.set_default_size(360, 480);
  const column = new GtkBox({ orientation: Orientation.VERTICAL, spacing: 6 });
  const entry = new GtkEntry({ placeholder_text: "A note" });
  const add = new GtkButton({ label: "Add" });
  const list = new GtkListBox({});
  const status = new GtkLabel({ label: "0 notes" });
  column.append(entry);
  column.append(add);
  column.append(list);
  column.append(status);
  window.set_child(column);
  window.present();

  const file = g_file_new_for_path(PATH);
  const notes = new Notes(file, list, status);
  for (const note of await load(file)) notes.show(note);
  notes_log("loaded " + String(notes.notes.length));

  let added = "";
  add.connect("clicked", () => {
    const text = entry.text;
    if (text.length === 0) return;
    notes.show(text);
    added += (added.length > 0 ? "," : "") + text;
    entry.text = "";
  });

  // Typed and added, as a person would.
  for (const text of ["milk", "bread", "tea"]) {
    entry.text = text;
    notes_emit(add, "clicked");
  }
  notes_log("added " + added);
  notes_log("count " + status.label);

  await save(file, notes.notes);
  notes_log("saved " + String(notes.notes.length));
  application.quit();
}

function main(): void {
  const application = new GtkApplication({ application_id: "dev.nts.Notes", flags: ApplicationFlags.NON_UNIQUE });
  application.connect("activate", () => {
    void open(application);
  });
  application.run(["notes"]);
}

main();
