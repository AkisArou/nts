// Arm C: as B, but projected through a generic type guard instead of bare `instanceof`.
abstract class Hook {
  next: Hook | null = null;
}
class StateHook<S> extends Hook {
  state: S;
  constructor(state: S) {
    super();
    this.state = state;
  }
}

let first: Hook | null = null;
let cursor: Hook | null = null;
let last: Hook | null = null;

function beginRender(): void {
  cursor = first;
}

function useState<S>(initial: S): S {
  const hook = cursor;
  if (hook === null) {
    const created = new StateHook<S>(initial);
    if (last === null) first = created;
    else last.next = created;
    last = created;
    return initial;
  }
  cursor = hook.next;
  if (isState<S>(hook)) return hook.state;
  throw new Error("hook order changed");
}

function setAt(index: number, value: number): void {
  let hook = first;
  for (let i = 0; i < index && hook !== null; i++) hook = hook.next;
  if (hook !== null && isState<number>(hook)) hook.state = value;
}

function Component(): string {
  const count = useState<number>(0);
  const label = useState<string>("clicks");
  return label + ": " + count;
}

export function renderTwice(next: number): string {
  beginRender();
  const a = Component();
  setAt(0, next);
  beginRender();
  return a + " / " + Component();
}

function isState<S>(hook: Hook): hook is StateHook<S> {
  return hook instanceof StateHook;
}
