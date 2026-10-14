// The journal on disk: an entry a line, its fields separated by tabs, read
// and written through Gio's data streams.
import { FileCreateFlags, g_data_input_stream_new, g_data_output_stream_new, g_file_new_for_path } from "c:Gio-2.0";
import { type Stored } from "./model.ts";

export function load(path: string): Stored[] {
  const stream = g_data_input_stream_new(g_file_new_for_path(path).read(null));
  const entries: Stored[] = [];
  for (;;) {
    const [line] = stream.read_line_utf8(null);
    if (line === null) break;
    const [title, body, day, tags, done] = line.split("\t");
    entries.push({ title, body, day: Number(day), tags, done: done === "1" });
  }
  stream.close(null);
  return entries;
}

// The bytes written, as the file holds them.
export function save(path: string, entries: Stored[]): number {
  const stream = g_data_output_stream_new(g_file_new_for_path(path).replace(null, false, FileCreateFlags.REPLACE_DESTINATION, null));
  let written = 0;
  for (const entry of entries) {
    const line = entry.title + "\t" + entry.body + "\t" + String(entry.day) + "\t" + entry.tags + "\t" + (entry.done ? "1" : "0") + "\n";
    stream.put_string(line, null);
    written += line.length;
  }
  stream.close(null);
  return written;
}
