// Drawing with cairo, as GJS draws: `cr.rectangle(...)`, `cr.fill()`.
//
// The log:
//   offscreen 64x32 in true false ok true  an image surface made by
//                 `cairo_surface_t.create_image`, a context by
//                 `cairo_t.create(surface)` -- each owned, freed by its box --
//                 a rectangle filled (`in_fill` inside and outside it) and
//                 text shown, the context's status still success
//   drawn true size 100x50  a `GtkDrawingArea`'s draw function, which GTK
//                 calls with a `cairo_t` -- a boxed record C lends, which the
//                 bridge boxes: a copy, by `cairo_gobject_context_get_type`
//   counted 2     inside the draw function, the context's references: GTK's
//                 own and the bridge's copy. A bridge that passed C's pointer
//                 unboxed crashed here; one that lent without copying reads 1
//   kept 1        the context the draw function kept, read after the frame:
//                 GTK has let go of its own, and the program's box holds the
//                 one copy -- a copy taken twice or never given back reads more
//   frames true growth 0  five more frames drawn, and the program's live
//                 objects counted before and after: under reference counting
//                 each frame's box is given back, so nothing grows. A bridge
//                 that never released its box grows one a frame. Without
//                 counting nothing is freed, and growth is positive by design
import { GtkApplication, GtkApplicationWindow, GtkDrawingArea } from "c:Gtk-4.0";
import { cairo_t, cairo_surface_t, Format, FontSlant, FontWeight, Status } from "c:cairo-1.0";
import { ApplicationFlags } from "c:Gio-2.0";
import { g_timeout_add_full } from "c:GLib-2.0";
import { cairo_fixture_live } from "c:live";

function offscreen(): string {
  const surface = cairo_surface_t.create_image(Format.ARGB32, 64, 32);
  const cr = cairo_t.create(surface);
  cr.set_source_rgb(1, 0, 0);
  cr.rectangle(8, 8, 16, 16);
  const inside = cr.in_fill(10, 10);
  const outside = cr.in_fill(40, 10);
  cr.fill();
  cr.select_font_face("Sans", FontSlant.NORMAL, FontWeight.BOLD);
  cr.set_font_size(12);
  cr.move_to(30, 20);
  cr.show_text("nts");
  surface.flush();
  return (
    "offscreen " + String(surface.get_width()) + "x" + String(surface.get_height()) + " in " + String(inside) + " " + String(outside) +
    " ok " + String(cr.status() === Status.SUCCESS)
  );
}

function main(): void {
  const app = new GtkApplication({ application_id: "dev.nts.Cairo", flags: ApplicationFlags.NON_UNIQUE });
  app.connect("activate", () => {
    console.log(offscreen());
    const area = new GtkDrawingArea({ content_width: 100, content_height: 50 });
    let drawn = 0;
    let size = "";
    let counted = 0;
    let kept: cairo_t | null = null;
    area.set_draw_func((_area, cr, width, height) => {
      cr.set_source_rgb(0.2, 0.4, 0.8);
      cr.arc(width / 2, height / 2, Math.min(width, height) / 3, 0, 2 * Math.PI);
      cr.fill_preserve();
      cr.set_line_width(2);
      cr.set_source_rgb(0, 0, 0);
      cr.stroke();
      if (drawn === 0) {
        counted = cr.get_reference_count();
        kept = cr;
      }
      drawn++;
      size = String(width) + "x" + String(height);
    });
    const window = new GtkApplicationWindow({ application: app, child: area });
    window.present();
    g_timeout_add_full(0, 300, () => {
      console.log("drawn " + String(drawn > 0) + " size " + size);
      console.log("counted " + String(counted) + " kept " + String(kept !== null ? kept.get_reference_count() : 0));
      kept = null;
      const first = drawn;
      let ticks = 0;
      let before = 0n;
      g_timeout_add_full(0, 40, () => {
        if (ticks === 0) before = cairo_fixture_live();
        if (ticks < 6) {
          ticks++;
          area.queue_draw();
          return true;
        }
        const growth = cairo_fixture_live() - before;
        console.log("frames " + String(drawn - first > 1) + " growth " + (growth === 0n ? "0" : "positive"));
        app.quit();
        return false;
      });
      return false;
    });
  });
  app.run(["cairo"]);
}

main();
