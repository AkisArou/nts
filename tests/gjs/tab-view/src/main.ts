// Workbench's "Tab View" demo (CC0, workbenchdev/demos), ported.
import { AdwStatusPage, AdwTabOverview, AdwTabView, type AdwTabPage } from "c:Adw-1";
import { GtkButton } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const tab_view = workbench.builder.get_object("tab_view");
  const button_new_tab = workbench.builder.get_object("button_new_tab");
  const overview = workbench.builder.get_object("overview");
  const button_overview = workbench.builder.get_object("button_overview");
  if (
    !(tab_view instanceof AdwTabView) ||
    !(button_new_tab instanceof GtkButton) ||
    !(overview instanceof AdwTabOverview) ||
    !(button_overview instanceof GtkButton)
  ) {
    throw new Error("the demo's UI");
  }
  let tab_count = 1;

  overview.connect("create-tab", () => {
    return add_page();
  });

  button_overview.connect("clicked", () => {
    overview.open = true;
  });

  button_new_tab.connect("clicked", () => {
    add_page();
  });

  // An arrow where the original declares a function: TypeScript keeps the
  // narrowing above only in what cannot be called before it.
  const add_page = (): AdwTabPage => {
    const title = `Tab ${tab_count}`;
    const page = create_page(title);
    const tab_page = tab_view.append(page);
    tab_page.title = title;
    tab_page.live_thumbnail = true;

    tab_count += 1;
    return tab_page;
  };
}

function create_page(title: string): AdwStatusPage {
  const page = new AdwStatusPage({
    title: title,
    vexpand: true,
  });
  return page;
}

run(demo);
