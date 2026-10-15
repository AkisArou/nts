// Calls through a signature, and which entry each takes.
//
// A site holding only a signature cannot know which closure arrives, so it
// calls the erased entry -- unless every closure that can arrive writes the
// ABI the site spells, when the typed one is sound and the erased one only
// boxes (`closure-merge`, 14x on the JVM).

// Two closures of one shape merged into one variable: typed.
export function merged(seed: number): number {
  let mix: (x: number) => number;
  if ((seed & 1) === 0) {
    mix = (x: number): number => (x * 3 + seed) | 0;
  } else {
    mix = (x: number): number => (x * 5 - seed) | 0;
  }
  let total = 0;
  for (let i = 0; i < 8; i++) total = (total ^ mix(i)) | 0;
  return total + drive(mix, 8);
}

// The same closures handed on through a separately written signature: typed,
// because what reaches `mix`'s signature flows into this one.
function drive(f: (x: number) => number, times: number): number {
  let total = 0;
  for (let i = 0; i < times; i++) total = (total ^ f(i)) | 0;
  return total;
}

// A closure that takes its parameter at another representation: erased. On a
// signature of its own, because the decision is the signature's: one closure
// that disagrees keeps every call through its signature uniform. The two
// closures are merged into one value, as `merged`'s are, so the call cannot be
// cloned per closure and must go through the signature.
export function disagree(seed: number): number {
  let g: (x: number, y: number) => number;
  if ((seed & 1) === 0) {
    g = (x: number | undefined, y: number): number => (x ?? 0) + y + seed;
  } else {
    g = (x: number, y: number): number => x * y - seed;
  }
  return callWide(g);
}
function callWide(g: (x: number, y: number) => number): number {
  return g(3, 4);
}

// A closure declaring fewer parameters than the call passes: erased, on a
// signature of its own too, merged the same way.
export function fewer(seed: number): number {
  let h: (x: number, y: string) => number;
  if ((seed & 1) === 0) {
    h = (): number => seed;
  } else {
    h = (x: number, y: string): number => x + y.length;
  }
  return callFewer(h);
}
function callFewer(h: (x: number, y: string) => number): number {
  return h(4, "ab");
}

// An implementation whose parameter is a narrower signature than its
// interface's, called through the interface: the adapter passes the
// interface's `() => unknown` straight to the implementation's `() => void`
// with no conversion, and a closure admitted to the first then reaches the
// second's call. So `() => void` stays uniform (the JVM lane's
// a-literal-thenable-dispatched-with-class-wakeables, reduced).
interface Wakeable {
  then(resolve: () => unknown): void;
}
class OneListener implements Wakeable {
  then(listener: () => void): void {
    listener();
  }
}
class TwoListeners implements Wakeable {
  then(listener: () => void): void {
    listener();
    listener();
  }
}
export function wake(seed: number): number {
  let woken = seed;
  const wakeables: Wakeable[] = [new OneListener(), new TwoListeners()];
  for (const wakeable of wakeables) {
    wakeable.then((): void => {
      woken += 1;
    });
    wakeable.then((): number => (woken *= 2));
  }
  return woken;
}
