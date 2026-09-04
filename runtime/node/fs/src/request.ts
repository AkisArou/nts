// The asynchronous-resource boundary shared by every callback-style fs request.

import { validateFunction } from "../../internal/validators.ts";
import { AsyncContextFrame } from "../../internal/async-context.ts";
import {
  emitAfter,
  emitBefore,
  emitDestroy,
  emitInit,
  getDefaultTriggerAsyncId,
  initHooksExist,
  newAsyncId,
} from "../../internal/async-hooks.ts";

export type Callback<T = void> = (error: unknown, value?: T) => void;

/** Validate and instrument the one callback owned by an fs request. */
export function asRequest<Arguments extends unknown[]>(
  callback: ((...args: Arguments) => void) | undefined,
  syscall: string,
  callbackName = "cb",
): (...args: Arguments) => void {
  validateFunction(callback, callbackName);

  const asyncId = newAsyncId();
  const trigger = getDefaultTriggerAsyncId();
  const frame = AsyncContextFrame.current();
  const resource = { syscall };
  if (initHooksExist()) emitInit(asyncId, "FSREQCALLBACK", trigger, resource);

  return (...args: Arguments) => {
    const prior = AsyncContextFrame.exchange(frame);
    emitBefore(asyncId, trigger, resource);
    try {
      callback(...args);
    } finally {
      emitAfter(asyncId);
      emitDestroy(asyncId);
      AsyncContextFrame.setCurrent(prior);
    }
  };
}
