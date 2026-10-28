import type { NavigatorCapability } from "../provider/navigator.ts";

const navigatorConstructorKey = Symbol("Navigator constructor");

/** HTML 8.10.1: the minimal environment-owned Navigator identity surface. */
export class Navigator {
  readonly #capability: NavigatorCapability;
  readonly [Symbol.toStringTag] = "Navigator";

  constructor(
    key: typeof navigatorConstructorKey | undefined = undefined,
    capability?: NavigatorCapability,
  ) {
    if (key !== navigatorConstructorKey || capability === undefined) {
      throw new TypeError("Illegal constructor");
    }
    this.#capability = capability;
  }

  /** https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-useragent */
  get userAgent(): string {
    return this.#capability.userAgent();
  }
}

/** @internal Bootstrap creates one instance for its environment's global. */
export function createNavigator(capability: NavigatorCapability): Navigator {
  return new Navigator(navigatorConstructorKey, capability);
}
