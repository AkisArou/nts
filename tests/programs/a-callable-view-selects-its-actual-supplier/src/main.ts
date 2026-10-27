// Additional supplier and evaluation guards for the one-difference pair in
// an-optional-callable-property-supplied-by-a-method.
interface Maybe {
  tag: number;
  run?: ((n: number) => number) | undefined;
}

class Method {
  tag: number = 3;
  run(n: number): number {
    return this.tag + n;
  }
}
class Callback extends Method {
  override run = (n: number): number => this.tag + n + 100;
}
class Missing {
  tag: number = 3;
}

function choose(n: number, stored: Callback): Maybe {
  if ((n & 3) === 1) return new Method();
  if ((n & 3) === 2) return stored;
  return new Missing();
}

export function optional(n: number): number {
  const target = choose(n, new Callback());
  return target.run?.(n) ?? -1;
}
export function present(n: number): boolean {
  const target = choose(n, new Callback());
  return target.run !== undefined;
}
export function typeofPresent(n: number): boolean {
  const target = choose(n, new Callback());
  return typeof target.run === "function";
}
export function argumentsAreLazy(n: number): number {
  const target = choose(n, new Callback());
  let evaluated = 0;
  const result = target.run?.((evaluated = 7)) ?? -1;
  return result * 100 + evaluated;
}
export function receiverRunsOnce(n: number): number {
  let seen = 0;
  function receiver(): Maybe {
    seen += 1;
    return choose(n, new Callback());
  }
  const result = receiver().run?.(n) ?? -1;
  return result * 100 + seen;
}
function replace(stored: Callback): number {
  stored.run = (n: number): number => stored.tag + n + 200;
  return 7;
}
export function callbackIsReadBeforeArguments(n: number): number {
  const stored = new Callback();
  const target = choose(n, stored);
  return target.run?.(replace(stored)) ?? -1;
}
