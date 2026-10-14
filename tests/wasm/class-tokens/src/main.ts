// A class used as a value is a token: one immutable object per class, the
// same wherever the name is written, `typeof` "function", compared by
// identity. And an open value compared with a typed object is the same object
// or not, whatever else it holds.

class Message {
  constructor(public n: number) {}
}

class Other {
  constructor(public n: number) {}
}

class Holder {
  constructor(public kind: typeof Message) {}
}

export function sameToken(v: number): number {
  const kept = new Holder(Message);
  return (kept.kind === Message ? 1 : 0) + (v > 0 ? 10 : 20);
}

// Each token is erased on its own: two tokens joined in one conditional are a
// function type whose storage neither extends, which Wasm refuses by name.
function open(value: unknown): unknown {
  return value;
}

export function distinctTokens(v: number): number {
  const token = v > 0 ? open(Message) : open(Other);
  return (token === Message ? 1 : 0) + (token === Other ? 10 : 0) + (token !== Message ? 100 : 0);
}

export function tokenType(v: number): string {
  const token = v > 0 ? open(Message) : open(Other);
  return typeof token;
}

export function objectIdentity(v: number): number {
  const mine = new Message(v);
  const other = new Message(v);
  const open: unknown = v > 0 ? mine : other;
  return (open === mine ? 1 : 0) + (open === other ? 10 : 0) + (mine === open ? 100 : 0);
}

export function notAnObject(v: number): number {
  const mine = new Message(v);
  const open: unknown = v > 0 ? "text" : v;
  return (open === mine ? 1 : 0) + (open !== mine ? 10 : 0);
}
