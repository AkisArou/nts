import { Event, eventApplyConvertedInit } from "./events.ts";
import type { EventInit } from "./events.ts";
import { coerceToDOMString, requireArguments, requireDictionary } from "./webidl.ts";

export interface ProgressEventInit extends EventInit {
  lengthComputable?: boolean;
  loaded?: number;
  total?: number;
}

function progressDouble(value: number | undefined): number {
  if (value === undefined) return 0;
  const number = +value;
  if (!Number.isFinite(number)) throw new TypeError("ProgressEvent values must be finite doubles");
  return number;
}

/** XMLHttpRequest §5: progress metadata over the canonical DOM Event. */
export class ProgressEvent extends Event {
  readonly #lengthComputable: boolean;
  readonly #loaded: number;
  readonly #total: number;
  readonly [Symbol.toStringTag] = "ProgressEvent";

  constructor(type: string, init: ProgressEventInit = {}) {
    requireArguments(arguments, 1, "ProgressEvent constructor");
    const convertedType = coerceToDOMString(type);
    requireDictionary(init, "ProgressEvent init");
    let bubbles = false;
    let cancelable = false;
    let composed = false;
    let lengthComputable = false;
    let loaded = 0;
    let total = 0;
    if (init !== undefined && init !== null) {
      // Inherited EventInit members precede ProgressEventInit members. Complete
      // conversion before Event captures its timestamp or initializes its slots.
      bubbles = !!init.bubbles;
      cancelable = !!init.cancelable;
      composed = !!init.composed;
      lengthComputable = !!init.lengthComputable;
      loaded = progressDouble(init.loaded);
      total = progressDouble(init.total);
    }
    super(convertedType);
    this[eventApplyConvertedInit](bubbles, cancelable, composed);
    this.#lengthComputable = lengthComputable;
    this.#loaded = loaded;
    this.#total = total;
  }

  get lengthComputable(): boolean {
    return this.#lengthComputable;
  }

  get loaded(): number {
    return this.#loaded;
  }

  get total(): number {
    return this.#total;
  }
}
