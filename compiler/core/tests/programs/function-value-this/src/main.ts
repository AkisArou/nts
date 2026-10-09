// Each call is through a function value whose closure the site cannot know --
// the parameter's type is the signature, not a closure class -- so each is made
// at the uniform entry, which takes the call's `this`.
type Handler = (x: number) => number;

class Holder {
  constructor(public handle: Handler) {}
}

export function plain(f: Handler): number {
  return f(1);
}

export function throughAField(o: Holder): number {
  return o.handle(2);
}

export function throughCall(f: Handler, r: Holder): number {
  return f.call(r, 3);
}

export function throughCallOfUndefined(f: Handler): number {
  return f.call(undefined, 4);
}

export function throughApply(f: (...xs: number[]) => number, r: Holder): number {
  return f.apply(r, [5]);
}

export function main(): number {
  const h = new Holder((x) => x + 1);
  return (
    plain((x) => x * 2) +
    throughAField(h) +
    throughCall((x) => x - 1, h) +
    throughCallOfUndefined((x) => x) +
    throughApply((...xs) => xs.length, h)
  );
}
