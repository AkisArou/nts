// run: check
// backend: jvm
// Reduced from the executed erased generic-return neighbor of
// a-generic-interface-whose-member-returns-its-type-parameter. Erasing the
// structural object to unknown and reading it back as Lazy<unknown, unknown>
// reaches a JVM stateful-interface cast stop. The direct typed call is the
// one-difference control. C and LLVM execute the same values correctly.
interface Lazy<T, P> {
  readonly tag: number;
  payload: P;
  init: (payload: P) => T;
}

function resolveLazy<T>(lazy: Lazy<T, unknown>): T {
  const payload = lazy.payload;
  const init = lazy.init;
  return init(payload);
}

function render(type: unknown): string {
  if (typeof type === "object" && type !== null && "init" in type) {
    return String(resolveLazy(type as Lazy<unknown, unknown>));
  }
  return "plain";
}

export function subject(n: number): string {
  const input: Lazy<string, unknown> = {
    tag: 1, payload: n, init: (payload: unknown): string => String(payload),
  };
  return render(input);
}
export function control(n: number): string {
  const input: Lazy<string, unknown> = {
    tag: 1, payload: n, init: (payload: unknown): string => String(payload),
  };
  return String(resolveLazy(input));
}
