// A libadwaita journal: a sidebar of entries, sorted and searched; an editor
// bound to the one selected; a chart of entries per month; actions for new,
// delete, save and the sort order. Driven headless by a scripted workload
// (`drive`), whose log is compared with the GJS twin's
// (tooling/gtk-bench/gjs/journal.js) and whose `ms` lines are the timings.
import {
  AdwApplication,
  AdwApplicationWindow,
  AdwHeaderBar,
  AdwNavigationPage,
  AdwNavigationSplitView,
  AdwToast,
  AdwToastOverlay,
  AdwToolbarView,
} from "c:Adw-1";
import { GtkBox, GtkMenuButton, Orientation } from "c:Gtk-4.0";
import { ApplicationFlags, GMenu, GSimpleAction } from "c:Gio-2.0";
import { g_get_monotonic_time, g_timeout_add_full, g_variant_get_boolean, g_variant_new_boolean } from "c:GLib-2.0";
import { Entry, entryOf, storedOf } from "./model.ts";
import { load, save } from "./io.ts";
import { Sidebar } from "./sidebar.ts";
import { EntryView } from "./entry-view.ts";
import { Chart } from "./chart.ts";

const path = "/tmp/nts-gtk-journal.txt";
const saved = "/tmp/nts-gtk-journal-saved.txt";

function now(): number {
  return Number(g_get_monotonic_time()) / 1000;
}

class Journal {
  readonly sidebar = new Sidebar();
  readonly editor = new EntryView({});
  readonly chart: Chart;
  readonly overlay = new AdwToastOverlay({});
  readonly window: AdwApplicationWindow;
  added = 0;

  constructor(readonly app: AdwApplication) {
    this.chart = new Chart(this.sidebar.store);
    this.actions();
    const header = new AdwHeaderBar({});
    const menu = new GMenu();
    menu.append("New", "app.new");
    menu.append("Delete", "app.delete");
    menu.append("Save", "app.save");
    menu.append("Sort by title", "app.sort-title");
    header.pack_end(new GtkMenuButton({ menu_model: menu, icon_name: "open-menu-symbolic" }));
    const content = new GtkBox({ orientation: Orientation.VERTICAL, spacing: 12 });
    content.append(this.editor);
    content.append(this.chart.area);
    const split = new AdwNavigationSplitView({
      sidebar: new AdwNavigationPage({ title: "Journal", child: this.sidebar.scrolled }),
      content: new AdwNavigationPage({ title: "Entry", child: content }),
    });
    this.overlay.child = split;
    const view = new AdwToolbarView({ content: this.overlay });
    view.add_top_bar(header);
    this.window = new AdwApplicationWindow({ application: app, content: view, default_width: 900, default_height: 600 });
    this.sidebar.selection.connect("notify::selected", () => this.editor.edit(this.sidebar.selected()));
  }

  private actions(): void {
    const add = new GSimpleAction({ name: "new" });
    add.connect("activate", () => {
      this.added++;
      this.sidebar.store.append(entryOf({ title: "new " + String(this.added), body: "", day: this.added % 365, tags: "new", done: false }));
    });
    const remove = new GSimpleAction({ name: "delete" });
    remove.connect("activate", () => {
      const entry = this.sidebar.selected();
      if (entry === null) return;
      const [found, at] = this.sidebar.store.find(entry);
      if (found) this.sidebar.store.remove(at);
    });
    const store = new GSimpleAction({ name: "save" });
    store.connect("activate", () => {
      const entries = [];
      for (let at = 0; at < this.sidebar.store.get_n_items(); at++) {
        const entry = this.sidebar.store.get_item(at);
        if (entry instanceof Entry) entries.push(storedOf(entry));
      }
      const bytes = save(saved, entries);
      this.overlay.add_toast(new AdwToast({ title: "Saved " + String(entries.length) }));
      console.log("saved " + String(entries.length) + " " + String(bytes));
    });
    const sortTitle = new GSimpleAction({ name: "sort-title", state: g_variant_new_boolean(false) });
    sortTitle.connect("change-state", (action, value) => {
      if (value === null) return;
      action.set_state(value);
      this.sidebar.sortByTitle(g_variant_get_boolean(value));
    });
    for (const action of [add, remove, store, sortTitle]) this.app.add_action(action);
    this.app.set_accels_for_action("app.new", ["<Control>n"]);
    this.app.set_accels_for_action("app.save", ["<Control>s"]);
  }
}

// The workload: each phase timed on its own `ms` line.
function drive(journal: Journal): void {
  const { app, sidebar } = journal;
  let started = now();
  for (const one of load(path)) sidebar.store.append(entryOf(one));
  console.log("loaded " + String(sidebar.store.get_n_items()));
  console.log("ms load " + String(Math.round(now() - started)));

  started = now();
  let seen = 0;
  for (let i = 0; i < 20; i++) {
    sidebar.search("tag" + String(i % 7));
    seen += sidebar.visible.get_n_items();
  }
  sidebar.search("");
  console.log("searched " + String(seen));
  console.log("ms search " + String(Math.round(now() - started)));

  started = now();
  let byTitle = false;
  for (let i = 0; i < 10; i++) {
    byTitle = !byTitle;
    app.change_action_state("sort-title", g_variant_new_boolean(byTitle));
  }
  const top = sidebar.visible.get_item(0);
  console.log("sorted " + (top instanceof Entry ? top.title : "?"));
  console.log("ms sort " + String(Math.round(now() - started)));

  started = now();
  for (let i = 0; i < 200; i++) {
    app.activate_action("new", null);
    sidebar.selection.selected = sidebar.visible.get_n_items() - 1;
    journal.editor.title_row.text = "edited " + String(i);
  }
  const edited = sidebar.selected();
  console.log("added " + String(sidebar.store.get_n_items()) + " " + (edited !== null ? edited.title : "?") + " edits " + String(journal.editor.edits));
  console.log("ms add " + String(Math.round(now() - started)));

  started = now();
  let frames = 0;
  g_timeout_add_full(0, 16, () => {
    journal.chart.area.queue_draw();
    frames++;
    if (frames < 50) return true;
    console.log("charted " + String(journal.chart.frames > 0) + " peak " + String(journal.chart.peak));
    console.log("ms chart " + String(Math.round(now() - started)));
    app.activate_action("delete", null);
    console.log("deleted " + String(sidebar.store.get_n_items()));
    started = now();
    app.activate_action("save", null);
    console.log("ms save " + String(Math.round(now() - started)));
    app.quit();
    return false;
  });
}

function main(): void {
  const app = new AdwApplication({ application_id: "dev.nts.Journal", flags: ApplicationFlags.NON_UNIQUE });
  app.connect("activate", () => {
    const journal = new Journal(app);
    journal.window.present();
    drive(journal);
  });
  app.run(["journal"]);
}

main();
