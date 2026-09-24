// A GTK application whose loop is GLib's, and the program's own timers and
// promise jobs running inside it.
//
// The log is the assertion, and build.sh checks its order:
//
//   early-timer   a timer set before `g_application_run` fires while it runs,
//                 which only happens if GLib's loop is turning libuv's.
//   click         a click dispatched by GLib, with nothing compiled below it,
//   micro         and the promise job it queued, run as the handler returns
//                 to the loop -- before any later event;
//   timeout       then the timer it set.
//   task-start    Inside that timer's task, a click emitted synchronously:
//   click-sync    its handler queues a promise job,
//   task-end      which must not run in the middle of the task
//   micro-sync    but after it.
//   nested        A third click, from GLib's dispatch again, whose handler
//   spun          sets a timer and turns GLib's loop itself, as a modal
//                 dialog would: libuv's source must not run the timer in there,
//   micro-nested  with the handler's frames still below it -- its promise job
//   timeout-nested  first, once the handler returns, and then the timer.
//   quit
import {
  g_application_run,
  gtk_application_new,
  gtk_application_window_new,
  gtk_button_new,
  gtk_window_present,
  gtk_window_set_child,
  loop_as_window,
  loop_click_later,
  loop_click_now,
  loop_connect,
  loop_spin,
  loop_control,
  loop_log,
  loop_quit,
  loop_unref,
} from "c:gtk-loop";
import type { c_int, c_uint } from "c:types";

// Logs `line` from a promise job: the `await` suspends, and what follows it
// runs as a microtask. (`Promise.prototype.then` is not lowered yet.)
async function afterAJob(line: string): Promise<void> {
  await 0;
  loop_log(line);
}

function main(): void {
  const app = gtk_application_new("dev.nts.GtkLoop", 0x20 as c_uint);
  loop_control(app);
  setTimeout(() => {
    loop_log("early-timer");
  }, 0);
  let clicks = 0;
  loop_connect(app, "activate", () => {
    const window = gtk_application_window_new(app);
    const button = gtk_button_new();
    gtk_window_set_child(loop_as_window(window), button);
    loop_connect(button, "clicked", () => {
      clicks++;
      if (clicks === 1) {
        loop_log("click");
        void afterAJob("micro");
        setTimeout(() => {
          loop_log("timeout");
          loop_log("task-start");
          loop_click_now(button);
          loop_log("task-end");
          loop_click_later(button);
        }, 0);
      } else if (clicks === 2) {
        loop_log("click-sync");
        void afterAJob("micro-sync");
      } else {
        loop_log("nested");
        void afterAJob("micro-nested");
        setTimeout(() => {
          loop_log("timeout-nested");
          loop_log("quit");
          loop_quit(app);
        }, 0);
        loop_spin();
        loop_log("spun");
      }
    });
    gtk_window_present(loop_as_window(window));
    loop_click_later(button);
  });
  g_application_run(app, 0 as c_int, null);
  loop_unref(app);
  loop_log("done");
}

main();
