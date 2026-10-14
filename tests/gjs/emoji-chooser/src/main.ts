// Workbench's "Emoji Chooser" demo (CC0, workbenchdev/demos), ported.
import { GtkEmojiChooser, GtkMenuButton } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const emoji_chooser = workbench.builder.get_object("emoji_chooser");
  const button = workbench.builder.get_object("button");
  if (!(emoji_chooser instanceof GtkEmojiChooser) || !(button instanceof GtkMenuButton)) {
    throw new Error("the demo's UI");
  }

  emoji_chooser.connect("emoji-picked", (_self, emoji) => {
    button.label = emoji;
  });
}

run(demo);
