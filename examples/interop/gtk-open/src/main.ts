// An application that opens files, as GJS writes one: `HANDLES_OPEN`, and an
// `open` handler that takes the files as one array. C passes `GFile **files,
// gint n_files`; the bridge makes them one `readonly GFile[]` whose elements
// hold references of their own (`nts_array_from_handles`), and the length
// never reaches the program.
//
// The program opens the files itself -- `app.open(files, hint)`, the array
// lent to C in place (`CHandles`) -- so no command line is needed.
//
// The log:
//   open 2 a.txt,b.txt hint  the handler's array: its length, each file's
//                 basename, and the hint beside it
//   kept a.txt,b.txt  the same array read after the handler returned, from
//                 where the handler stored it: under `--rc` the bridge gives
//                 its reference back after the call, and the program's store
//                 is what keeps the array -- and each file -- alive
//   opened 1      the handler ran once
import { ApplicationFlags, GApplication, type GFile, g_file_new_for_path } from "c:Gio-2.0";

let kept: readonly GFile[] = [];
let opened = 0;

function names(files: readonly GFile[]): string {
  let out = "";
  for (const file of files) out += (out === "" ? "" : ",") + (file.get_basename() ?? "?");
  return out;
}

function main(): void {
  const app = new GApplication({ application_id: "dev.nts.Open", flags: ApplicationFlags.HANDLES_OPEN | ApplicationFlags.NON_UNIQUE });
  app.connect("open", (_app, files, hint) => {
    console.log("open " + String(files.length) + " " + names(files) + " " + hint);
    kept = files;
    opened++;
  });
  app.connect("activate", () => {
    app.open([g_file_new_for_path("/tmp/a.txt"), g_file_new_for_path("/tmp/b.txt")], "hint");
    console.log("kept " + names(kept));
  });
  app.run(["open"]);
  console.log("opened " + String(opened));
}

main();
