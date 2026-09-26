// Entries per month, drawn with cairo: the counts are the program's own
// aggregation over the store, redone each frame.
import { GtkDrawingArea } from "c:Gtk-4.0";
import { GListStore } from "c:Gio-2.0";
import { Entry } from "./model.ts";

export function monthly(store: GListStore): number[] {
  const counts: number[] = [];
  for (let month = 0; month < 13; month++) counts.push(0);
  for (let at = 0; at < store.get_n_items(); at++) {
    const entry = store.get_item(at);
    if (entry instanceof Entry) counts[Math.floor(entry.day / 30)]++;
  }
  return counts;
}

export class Chart {
  readonly area = new GtkDrawingArea({ content_height: 120, hexpand: true });
  frames = 0;
  peak = 0;

  constructor(store: GListStore) {
    this.area.set_draw_func((_area, cr, width, height) => {
      const counts = monthly(store);
      let peak = 1;
      for (const count of counts) peak = Math.max(peak, count);
      const bar = width / counts.length;
      cr.set_source_rgb(0.21, 0.52, 0.89);
      for (let month = 0; month < counts.length; month++) {
        const tall = (counts[month] / peak) * (height - 4);
        cr.rectangle(month * bar + 2, height - tall, bar - 4, tall);
      }
      cr.fill();
      this.frames++;
      this.peak = peak;
    });
  }
}
