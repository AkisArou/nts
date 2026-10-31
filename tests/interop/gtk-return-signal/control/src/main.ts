import {GtkButton, gtk_init} from "c:Gtk-4.0";
gtk_init();
const button = new GtkButton();
let calls = 0;
button.connect("clicked", () => { calls++; });
button.emit("clicked");
console.log("signal void: " + String(calls));
