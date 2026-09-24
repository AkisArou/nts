// A program whose loop is the main CFRunLoop, and its own timers and promise
// jobs running inside it. The macOS twin of `gtk-loop`.
//
// The log is the assertion, and build.sh checks its order:
//
//   early-timer   a timer set before `loop_run` fires while it runs, which
//                 only happens if the run loop is turning libuv's;
//   event         an event the run loop dispatches, with nothing compiled
//                 below it,
//   micro         and the promise job it queued, run as the callback returns
//                 to the loop, before any later event;
//   timeout       then the timer it set.
//   task-start    Inside that timer's task, the event dispatched synchronously:
//   event-sync    its handler queues a promise job,
//   task-end      which must not run in the middle of the task
//   micro-sync    but after it.
//   quit
import {
  loop_control,
  loop_event_later,
  loop_event_now,
  loop_log,
  loop_run,
  loop_stop,
} from "c:loop";

// Logs `line` from a promise job: the `await` suspends, and what follows it
// runs as a microtask.
async function afterAJob(line: string): Promise<void> {
  await 0;
  loop_log(line);
}

let events = 0;

function onEvent(): void {
  events++;
  if (events === 1) {
    loop_log("event");
    void afterAJob("micro");
    setTimeout(() => {
      loop_log("timeout");
      loop_log("task-start");
      loop_event_now(onEvent);
      loop_log("task-end");
      setTimeout(() => {
        loop_log("quit");
        loop_stop();
      }, 0);
    }, 0);
  } else {
    loop_log("event-sync");
    void afterAJob("micro-sync");
  }
}

function main(): void {
  loop_control();
  setTimeout(() => {
    loop_log("early-timer");
  }, 0);
  loop_event_later(onEvent);
  loop_run();
  loop_log("done");
}

main();
