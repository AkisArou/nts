// A task list, written as GJS would write it, whose time is its own code: ten
// thousand tasks made and sorted in the program, each a `Task` -- a class the
// program writes over `GObject`, holding its own fields -- in a `GListStore`
// made with `item_type: Task.$gtype`, shown through a list view, and a search
// entry whose every change re-runs a `GtkCustomFilter`: a TypeScript closure
// GTK calls once per task, which narrows the item with `instanceof Task` and
// matches the query against its words. It types a sequence of queries as a
// person would, logs how many tasks each one leaves, and quits.
//
// The log:
//   tasks 10000        the tasks made and sorted (`sort`, with a comparator)
//   first ...          the first after sorting: priority, then title
//   q "<query>" N      each query typed, and the tasks it leaves
//   bound rows         the list view laid out rows from the filtered model
//   ms made M typed T  milliseconds making and sorting the tasks, and typing
//                      every query: the timing, which a comparison of the
//                      two programs' logs leaves out
//
// `../gjs/tasks.js` is this program line for line, and prints the same log.
import {
  GtkApplication,
  GtkApplicationWindow,
  GtkBox,
  GtkEntry,
  GtkFilterListModel,
  GtkLabel,
  GtkListView,
  GtkSignalListItemFactory,
  GtkSingleSelection,
  FilterChange,
  Orientation,
  gtk_custom_filter_new,
} from "c:Gtk-4.0";
import { asGtkLabel, asGtkListItem } from "../types/gir/Gtk-4.0.values.ts";
import { ApplicationFlags, GListStore } from "c:Gio-2.0";
import { GObject } from "c:GObject-2.0";
import { g_timeout_add_full } from "c:GLib-2.0";
import { tasks_log, tasks_now } from "c:tasks";

const VERBS = ["buy", "call", "write", "fix", "read", "plan", "clean", "send", "book", "review"];
const NOUNS = ["milk", "report", "car", "letter", "garden", "budget", "tickets", "slides", "invoice", "roof", "notes", "bike"];
const COUNT = 10000;

interface Made {
  title: string;
  priority: number;
  words: string[];
}

class Task extends GObject {
  title = "";
  priority = 0;
  words: string[] = [];
}

// Deterministic, so both programs make the same tasks: a linear congruential
// generator, as small as it can be and still spread.
function makeTasks(): Made[] {
  const tasks: Made[] = [];
  let seed = 7;
  for (let i = 0; i < COUNT; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const verb = VERBS[seed % VERBS.length];
    const noun = NOUNS[Math.floor(seed / 16) % NOUNS.length];
    const priority = Math.floor(seed / 256) % 4;
    const title = verb + " the " + noun + " #" + String(i);
    tasks.push({ title, priority, words: title.split(" ") });
  }
  tasks.sort((a, b) => (a.priority !== b.priority ? a.priority - b.priority : a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  return tasks;
}

// Every word of the query is the start of some word of the title, ignoring
// case: "bu mi" finds "buy the milk".
function matches(task: Task, query: string[]): boolean {
  for (const want of query) {
    let found = false;
    for (const word of task.words) {
      if (word.toLowerCase().startsWith(want)) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

function open(application: GtkApplication): void {
  const start = tasks_now();
  const tasks = makeTasks();
  const made = tasks_now() - start;
  tasks_log("tasks " + String(tasks.length));
  tasks_log("first " + String(tasks[0].priority) + " " + tasks[0].title);
  const store = new GListStore({ item_type: Task.$gtype });
  for (const made of tasks) {
    const task = new Task({});
    task.title = made.title;
    task.priority = made.priority;
    task.words = made.words;
    store.append(task);
  }

  let query: string[] = [];
  const filter = gtk_custom_filter_new((item) => item instanceof Task && matches(item, query));
  const shown = new GtkFilterListModel({ model: store, filter });

  const factory = new GtkSignalListItemFactory({});
  let bound = 0;
  factory.connect("setup", (_factory, object) => {
    const item = asGtkListItem(object);
    if (item !== null) item.child = new GtkLabel({ xalign: 0 });
  });
  factory.connect("bind", (_factory, object) => {
    const item = asGtkListItem(object);
    if (item === null) return;
    const label = asGtkLabel(item.child);
    const task = item.item;
    if (label !== null && task instanceof Task) {
      label.label = task.title;
      bound++;
    }
  });

  const entry = new GtkEntry({ placeholder_text: "Search" });
  entry.connect("changed", () => {
    query = entry.text.toLowerCase().split(" ").filter((word) => word.length > 0);
    filter.changed(FilterChange.DIFFERENT);
  });

  const column = new GtkBox({ orientation: Orientation.VERTICAL, spacing: 6 });
  column.append(entry);
  column.append(new GtkListView({ model: new GtkSingleSelection({ model: shown }), factory, vexpand: true }));
  const window = new GtkApplicationWindow({ application, title: "Tasks" });
  window.set_default_size(360, 480);
  window.set_child(column);
  window.present();

  // Typed as a person would: a letter at a time, then another search.
  const typing = tasks_now();
  for (const text of ["b", "bu", "buy", "buy m", "buy mi", "", "r", "re", "rev", "review s", "#12", "#123", "plan the", "zz", ""]) {
    entry.text = text;
    tasks_log("q \"" + text + "\" " + String(shown.get_n_items()));
  }
  tasks_log("ms made " + made.toFixed(2) + " typed " + (tasks_now() - typing).toFixed(2));
  g_timeout_add_full(0, 200, () => {
    tasks_log(bound > 0 ? "bound rows" : "bound nothing");
    application.quit();
    return false;
  });
}

function main(): void {
  const application = new GtkApplication({ application_id: "dev.nts.Tasks", flags: ApplicationFlags.NON_UNIQUE });
  application.connect("activate", () => {
    open(application);
  });
  application.run(["tasks"]);
}

main();
