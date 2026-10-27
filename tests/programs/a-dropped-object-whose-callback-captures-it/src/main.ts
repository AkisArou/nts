// A callback that captures its holder makes a cycle. Passing the holder to a
// function that may publish it requires heap storage, including on the path
// that does not publish. Dropping that cycle must leave no counted storage.
// The first control changes only the callback body to a non-capturing one;
// the second calls the same capturing callback directly in its frame.
class Session {
  onClose = (): number => this.cleanup();
  cleanup(): number { return 1; }
}
class PlainSession {
  onClose = (): number => 1;
  cleanup(): number { return 1; }
}
let saved: Session | null = null;
let plainSaved: PlainSession | null = null;
function touch(n: number, session: Session): void {
  if ((n & 1) === 1) {
    saved = session;
    saved = null;
  }
}
function touchPlain(n: number, session: PlainSession): void {
  if ((n & 1) === 1) {
    plainSaved = session;
    plainSaved = null;
  }
}
export function captured(n: number): number {
  const session = new Session();
  touch(n, session);
  return n;
}
export function notCaptured(n: number): number {
  const session = new PlainSession();
  touchPlain(n, session);
  return n;
}
export function framePlaced(n: number): number {
  const session = new Session();
  return session.onClose() + n;
}
export function peek(n: number): number {
  return (saved?.onClose() ?? n) + (plainSaved?.onClose() ?? n);
}
