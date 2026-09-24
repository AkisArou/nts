// Arm A: one hook node class; state stored as `unknown`, read back with `as S`.
class HookNode {
  state: unknown;
  next: HookNode | null = null;
  constructor(state: unknown) {
    this.state = state;
  }
}

let first: HookNode | null = null;
let cursor: HookNode | null = null;
let last: HookNode | null = null;

function beginRender(): void {
  cursor = first;
}

function useState<S>(initial: S): S {
  const hook = cursor;
  if (hook === null) {
    const created = new HookNode(initial);
    if (last === null) first = created;
    else last.next = created;
    last = created;
    return initial;
  }
  cursor = hook.next;
  return hook.state as S;
}

function setAt<S>(index: number, value: S): void {
  let hook = first;
  for (let i = 0; i < index && hook !== null; i++) hook = hook.next;
  if (hook !== null) hook.state = value;
}

function Component(): string {
  const count = useState<number>(0);
  const label = useState<string>("clicks");
  return label + ": " + count;
}

export function renderTwice(next: number): string {
  beginRender();
  const a = Component();
  setAt<number>(0, next);
  beginRender();
  return a + " / " + Component();
}
