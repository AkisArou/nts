import { setImmediate as nodeSetImmediate } from "node:timers";

// Runs a task on a later turn of the event loop, out of reach of fake
// timers: `act` uses it to wait for work a test cannot see. Jest's fake
// timers replace the global `setImmediate` and leave the `timers` module's
// alone, which is why upstream reaches for the module and so does this.
export function enqueueTask(task: () => void): void {
  nodeSetImmediate(task);
}
