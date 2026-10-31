import {GtkButton, DirectionType, gtk_init} from "c:Gtk-4.0";
gtk_init();
const button = new GtkButton();
let calls = 0;
button.connect("keynav-failed", (_self, _direction) => {
  calls++;
  return true;
});
const answered = button.emit("keynav-failed", DirectionType.TAB_FORWARD);
console.log("signal value: " + String(answered) + " " + String(calls));
