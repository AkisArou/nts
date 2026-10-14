// A journal entry: a GObject of the program's own, whose fields are
// properties, so views bind to them and hear them change.
import { GObject } from "c:GObject-2.0";
import type { Property } from "c:types";

export class Entry extends GObject {
  title: Property<string> = "";
  body: Property<string> = "";
  day: Property<number> = 0;
  tags: Property<string> = "";
  done: Property<boolean> = false;
}

export interface Stored {
  title: string;
  body: string;
  day: number;
  tags: string;
  done: boolean;
}

export function entryOf(stored: Stored): Entry {
  const entry = new Entry({});
  entry.title = stored.title;
  entry.body = stored.body;
  entry.day = stored.day;
  entry.tags = stored.tags;
  entry.done = stored.done;
  return entry;
}

export function storedOf(entry: Entry): Stored {
  return { title: entry.title, body: entry.body, day: entry.day, tags: entry.tags, done: entry.done };
}
