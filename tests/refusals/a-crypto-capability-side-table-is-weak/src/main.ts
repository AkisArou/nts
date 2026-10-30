// expect: a module-scope variable of unrepresentable type
// Crypto capability registry shape: register and retrieve an object-keyed provider.
// The one-difference control changes only WeakMap to Map; no collection is forced.
// Reuse both keys on every call, so replacing a provider reaches a steady state.
class Token { constructor(readonly id: number) {} }
class Provider { constructor(readonly value: number) {} }
const tokens = [new Token(0), new Token(1)];
const providers = new WeakMap<Token, Provider>();
function register(key: Token, provider: Provider): void { providers.set(key, provider); }
function lookup(key: Token): Provider | undefined { return providers.get(key); }
export function work(n: number): number {
  const provider = new Provider(n + 1);
  register(tokens[0], provider);
  register(tokens[1], provider);
  return lookup(tokens[n & 1])?.value ?? -1;
}
