import {GtkButton, gtk_init} from "c:Gtk-4.0";
class TemplateProbe extends GtkButton {
  static readonly template = `<interface>
    <template class="Nts_TemplateProbe" parent="GtkButton">
      
    </template>
  </interface>`;
  count = 0;
  onClicked(): void { this.count++; }
}
gtk_init();
const button = new TemplateProbe();
button.emit("clicked");
console.log("template count: " + String(button.count));
