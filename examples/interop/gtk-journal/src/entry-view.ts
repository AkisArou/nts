// The editor: a title and a body, built from a template, each bound both
// ways to the entry being edited.
import { AdwBin, AdwEntryRow } from "c:Adw-1";
import { GtkTextView } from "c:Gtk-4.0";
import { BindingFlags, type GBinding } from "c:GObject-2.0";
import { Entry } from "./model.ts";

export class EntryView extends AdwBin {
  static readonly template = `<interface>
  <template class="Nts_EntryView" parent="AdwBin">
    <child>
      <object class="GtkBox">
        <property name="orientation">vertical</property>
        <property name="spacing">6</property>
        <child>
          <object class="AdwEntryRow" id="title_row">
            <property name="title">Title</property>
            <signal name="changed" handler="onTitleChanged"/>
          </object>
        </child>
        <child>
          <object class="GtkTextView" id="body_view">
            <property name="vexpand">true</property>
            <property name="wrap-mode">word</property>
          </object>
        </child>
      </object>
    </child>
  </template>
</interface>`;
  declare readonly title_row: AdwEntryRow;
  declare readonly body_view: GtkTextView;
  edits = 0;
  private bindings: GBinding[] = [];

  onTitleChanged(_row: AdwEntryRow): void {
    this.edits++;
  }

  edit(entry: Entry | null): void {
    for (const binding of this.bindings) binding.unbind();
    this.bindings = [];
    if (entry === null) return;
    const both = BindingFlags.BIDIRECTIONAL | BindingFlags.SYNC_CREATE;
    this.bindings.push(entry.bind_property("title", this.title_row, "text", both));
    this.bindings.push(entry.bind_property("body", this.body_view.buffer, "text", both));
  }
}
