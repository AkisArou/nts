// Workbench's "Navigation View" demo (CC0, workbenchdev/demos), ported.
import { AdwNavigationPage, AdwNavigationView } from "c:Adw-1";
import { GtkButton, GtkLabel } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const nav_view = workbench.builder.get_object("nav_view");
  const nav_pageone = workbench.builder.get_object("nav_pageone");
  const next_button = workbench.builder.get_object("next_button");
  const previous_button = workbench.builder.get_object("previous_button");
  const nav_pagetwo = workbench.builder.get_object("nav_pagetwo");
  const nav_pagethree = workbench.builder.get_object("nav_pagethree");
  const nav_pagefour = workbench.builder.get_object("nav_pagefour");
  const title = workbench.builder.get_object("title");
  if (
    !(nav_view instanceof AdwNavigationView) ||
    !(nav_pageone instanceof AdwNavigationPage) ||
    !(next_button instanceof GtkButton) ||
    !(previous_button instanceof GtkButton) ||
    !(nav_pagetwo instanceof AdwNavigationPage) ||
    !(nav_pagethree instanceof AdwNavigationPage) ||
    !(nav_pagefour instanceof AdwNavigationPage) ||
    !(title instanceof GtkLabel)
  ) {
    throw new Error("the demo's UI");
  }

  next_button.connect("clicked", () => {
    switch (nav_view.visible_page) {
      case nav_pageone:
        nav_view.push(nav_pagetwo);
        break;
      case nav_pagetwo:
        nav_view.push(nav_pagethree);
        break;
      case nav_pagethree:
        nav_view.push(nav_pagefour);
        break;
    }
  });

  previous_button.connect("clicked", () => {
    nav_view.pop();
  });

  nav_view.connect("notify::visible-page", () => {
    previous_button.sensitive = nav_view.visible_page !== nav_pageone;
    next_button.sensitive = nav_view.visible_page !== nav_pagefour;
    title.label = nav_view.visible_page!.title;
  });
}

run(demo);
