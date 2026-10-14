// Workbench's "Search" demo (CC0, workbenchdev/demos), ported.
import { AdwActionRow } from "c:Adw-1";
import { GtkListBox, GtkListBoxRow, GtkSearchBar, GtkSearchEntry, GtkStack, GtkToggleButton, GtkWidget } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const button = workbench.builder.get_object("button_search");
  const searchbar = workbench.builder.get_object("searchbar");
  const searchentry = workbench.builder.get_object("searchentry");
  const stack = workbench.builder.get_object("stack");
  const main_page = workbench.builder.get_object("main_page");
  const search_page = workbench.builder.get_object("search_page");
  const status_page = workbench.builder.get_object("status_page");
  const listbox = workbench.builder.get_object("listbox");
  if (
    !(button instanceof GtkToggleButton) ||
    !(searchbar instanceof GtkSearchBar) ||
    !(searchentry instanceof GtkSearchEntry) ||
    !(stack instanceof GtkStack) ||
    !(main_page instanceof GtkWidget) ||
    !(search_page instanceof GtkWidget) ||
    !(status_page instanceof GtkWidget) ||
    !(listbox instanceof GtkListBox)
  ) {
    throw new Error("the demo's UI");
  }

  button.connect("clicked", () => {
    searchbar.search_mode_enabled = !searchbar.search_mode_enabled;
  });

  searchbar.connect("notify::search-mode-enabled", () => {
    if (searchbar.search_mode_enabled) {
      stack.visible_child = search_page;
    } else {
      stack.visible_child = main_page;
    }
  });

  const fruits = [
    "Apple 🍎️",
    "Orange 🍊️",
    "Pear 🍐️",
    "Watermelon 🍉️",
    "Melon 🍈️",
    "Pineapple 🍍️",
    "Grape 🍇️",
    "Kiwi 🥝️",
    "Banana 🍌️",
    "Peach 🍑️",
    "Cherry 🍒️",
    "Strawberry 🍓️",
    "Blueberry 🫐️",
    "Mango 🥭️",
    "Bell Pepper 🫑️",
  ];

  fruits.forEach((name) => {
    const row = new AdwActionRow({
      title: name,
    });
    listbox.append(row);
  });

  let results_count = 0;

  // An arrow, where GJS writes a function declaration: a declaration is
  // hoisted, so TypeScript does not carry the narrowing above into it.
  const filter = (row: GtkListBoxRow): boolean => {
    if (!(row instanceof AdwActionRow)) return false;
    const re = new RegExp(searchentry.text, "i");
    const match = re.test(row.title);
    if (match) results_count++;
    return match;
  };

  listbox.set_filter_func(filter);

  searchentry.connect("search-changed", () => {
    results_count = -1;
    listbox.invalidate_filter();
    if (results_count === -1) stack.visible_child = status_page;
    else if (searchbar.search_mode_enabled) stack.visible_child = search_page;
  });
}

run(demo);
