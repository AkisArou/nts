// Constants whose values live in prototype getters, under a reflective
// loop this compiler cuts.
//
// `runtime/web-platform`'s WebSocket carries its Web IDL instance
// constants this way (R-1): the getters on the class hold the values, and
// the module-level descriptor loop after the class redefines them as
// data properties where it runs. nts refuses the loop and cuts it
// (NTS1005), so what keeps `this.OPEN`, an outside `s.OPEN` and the state
// machine's own comparison answering 1 is that the getters survive and
// stay callable. A `declare`-only field does not: it gets a layout slot
// nothing writes, and reads answer 0. WebSocket itself is still blocked
// by unrelated backend declines, so this same-shaped case is the
// executed guard for the pattern it relies on.
//
// `probe` runs the pattern; `control` answers the same sum through
// plain initialized fields beside it in the same program.

class Socket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  get CONNECTING(): 0 {
    return 0;
  }
  get OPEN(): 1 {
    return 1;
  }
  private state = 0;
  openIt(): void {
    this.state = this.OPEN;
  }
  isOpen(): boolean {
    return this.state === this.OPEN;
  }
  get readyState(): number {
    return this.state;
  }
}
for (const [name, value] of [
  ["CONNECTING", 0],
  ["OPEN", 1],
] as const) {
  Object.defineProperty(Socket.prototype, name, {
    value,
    writable: false,
    enumerable: true,
    configurable: false,
  });
}

class PlainSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  private state = 0;
  openIt(): void {
    this.state = this.OPEN;
  }
  isOpen(): boolean {
    return this.state === this.OPEN;
  }
  get readyState(): number {
    return this.state;
  }
}

export function probe(seed: number): number {
  const s = new Socket();
  const before = s.isOpen() ? 100 : 0;
  s.openIt();
  return (
    s.CONNECTING * 1000 +
    s.OPEN * 100 +
    Socket.OPEN * 10 +
    s.readyState +
    before +
    (s.isOpen() ? 10000 : 0) +
    ((seed | 0) & 1)
  );
}

export function control(seed: number): number {
  const s = new PlainSocket();
  const before = s.isOpen() ? 100 : 0;
  s.openIt();
  return (
    s.CONNECTING * 1000 +
    s.OPEN * 100 +
    PlainSocket.OPEN * 10 +
    s.readyState +
    before +
    (s.isOpen() ? 10000 : 0) +
    ((seed | 0) & 1)
  );
}
