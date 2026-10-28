/** The wptserve stash belongs to one server instance, never to the process. */
export class WptServerState {
  readonly stash = new Map<string, unknown>();
  private readonly waiting = new Map<string, Set<(value: unknown) => void>>();
  private readonly controller = new AbortController();

  put(path: string, key: string, value: unknown): void {
    this.controller.signal.throwIfAborted();
    const id = JSON.stringify([path, key]);
    const receiver = this.waiting.get(id)?.values().next().value;
    if (receiver !== undefined) {
      receiver(value);
      return;
    }
    if (this.stash.has(id)) throw new Error("Duplicate WPT stash key: " + id);
    this.stash.set(id, value);
  }

  take(path: string, key: string): unknown {
    const id = JSON.stringify([path, key]);
    const value = this.stash.get(id) ?? null;
    this.stash.delete(id);
    return value;
  }

  wait(path: string, key: string, signal?: AbortSignal): Promise<unknown> {
    const combined = signal === undefined
      ? this.controller.signal
      : AbortSignal.any([this.controller.signal, signal]);
    if (combined.aborted) return Promise.reject(combined.reason);
    const value = this.take(path, key);
    if (value !== null) return Promise.resolve(value);
    const id = JSON.stringify([path, key]);
    return new Promise<unknown>((resolve, reject) => {
      const receivers = this.waiting.get(id) ?? new Set<(value: unknown) => void>();
      const cleanup = (): void => {
        combined.removeEventListener("abort", abort);
        receivers.delete(receive);
        if (receivers.size === 0) this.waiting.delete(id);
      };
      const receive = (result: unknown): void => { cleanup(); resolve(result); };
      const abort = (): void => { cleanup(); reject(combined.reason); };
      receivers.add(receive);
      this.waiting.set(id, receivers);
      combined.addEventListener("abort", abort, { once: true });
    });
  }

  close(): void {
    this.controller.abort(new Error("WPT server closed"));
    this.stash.clear();
  }
}
