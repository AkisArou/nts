// Workbench's "Level Bars" demo (CC0, workbenchdev/demos), ported.
import { GtkLabel, GtkLevelBar, GtkPasswordEntry } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const bar_continuous = workbench.builder.get_object("bar_continuous");
  const bar_discrete = workbench.builder.get_object("bar_discrete");
  const entry = workbench.builder.get_object("entry");
  const label_strength = workbench.builder.get_object("label_strength");
  if (
    !(bar_continuous instanceof GtkLevelBar) ||
    !(bar_discrete instanceof GtkLevelBar) ||
    !(entry instanceof GtkPasswordEntry) ||
    !(label_strength instanceof GtkLabel)
  ) {
    throw new Error("the demo's UI");
  }

  bar_continuous.add_offset_value("full", 100);
  bar_continuous.add_offset_value("half", 50);
  bar_continuous.add_offset_value("low", 25);

  bar_discrete.add_offset_value("very-weak", 1);
  bar_discrete.add_offset_value("weak", 2);
  bar_discrete.add_offset_value("moderate", 4);
  bar_discrete.add_offset_value("strong", 6);

  entry.connect("notify::text", () => {
    estimatePasswordStrength();
  });

  // This is not a secure way to estimate password strength
  // Use appropriate solutions instead
  // such as https://github.com/dropbox/zxcvbn
  // An arrow where the original declares a function: TypeScript keeps the
  // narrowing above only in what cannot be called before it.
  const estimatePasswordStrength = (): void => {
    const level = Math.min(Math.ceil(entry.text.length / 2), 6);

    switch (level) {
      case 1:
        label_strength.label = "Very Weak";
        label_strength.css_classes = ["very-weak-label"];
        break;
      case 2:
        label_strength.label = "Weak";
        label_strength.css_classes = ["weak-label"];
        break;
      case 3:
      case 4:
        label_strength.label = "Moderate";
        label_strength.css_classes = ["moderate-label"];
        break;
      case 5:
      case 6:
        label_strength.label = "Strong";
        label_strength.css_classes = ["strong-label"];
        break;
      default:
        label_strength.label = "";
        label_strength.css_classes = [];
    }

    bar_discrete.value = level;
  };
}

run(demo);
