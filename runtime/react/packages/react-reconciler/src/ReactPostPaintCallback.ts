import { requestPostPaintCallback } from "react-reconciler/ReactFiberConfig.ts";

let postPaintCallbackScheduled = false;
let callbacks: ((endTime: number) => void)[] = [];

// Batches callbacks to run after the next paint into one host request.
export function schedulePostPaintCallback(callback: (endTime: number) => void): void {
  callbacks.push(callback);
  if (!postPaintCallbackScheduled) {
    postPaintCallbackScheduled = true;
    requestPostPaintCallback((endTime) => {
      for (let i = 0; i < callbacks.length; i++) {
        callbacks[i]!(endTime);
      }
      postPaintCallbackScheduled = false;
      callbacks = [];
    });
  }
}
