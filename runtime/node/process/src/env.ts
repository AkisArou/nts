// `process.env`, from node v24.20.0 `src/node_env_var.cc`.
//
// Not a plain object with the environment copied into it. The environment is
// shared with the process itself -- `getenv` in a linked C library must see
// what JavaScript just assigned, and a child process inherits it -- so every
// read and write goes through to the real thing. Node implements that with
// V8 property interceptors on an exotic object; the same behaviour in
// TypeScript is a `Proxy`, which is what interceptors are for.
//
// The type discipline is the surprising part and it is deliberate. The
// environment is a map of strings to strings, with no way to represent
// anything else, so node refuses rather than coerces where coercion would
// lose: a symbol has no string form that round-trips, and an accessor has
// nowhere to live. Everything else is coerced, including `undefined`, which
// becomes the four characters `undefined` and is a real source of confusion
// worth knowing about rather than fixing.

import { ERR_INVALID_OBJECT_DEFINE_PROPERTY } from "../../internal/errors.ts";

/** Read one variable. Empty when unset, which `has` disambiguates. */
declare function nts_process_env(name: string): string;
declare function nts_process_env_has(name: string): boolean;
declare function nts_process_env_set(name: string, value: string): void;
declare function nts_process_env_delete(name: string): void;
/** Every name currently set, in the order the host reports them. */
declare function nts_process_env_keys(): string[];

/**
 * A property descriptor `process.env` will accept.
 *
 * The environment can be changed by anything in the process, so a property
 * that claimed to be non-configurable or non-writable would be claiming
 * something this object cannot enforce. Rejecting is the honest answer.
 */
function requireDataDescriptor(descriptor: PropertyDescriptor): void {
  if (descriptor.get !== undefined || descriptor.set !== undefined) {
    throw new ERR_INVALID_OBJECT_DEFINE_PROPERTY(
      "'process.env' does not accept an accessor(getter/setter) descriptor",
    );
  }
  if (
    descriptor.configurable !== true ||
    descriptor.writable !== true ||
    descriptor.enumerable !== true
  ) {
    throw new ERR_INVALID_OBJECT_DEFINE_PROPERTY(
      "'process.env' only accepts a configurable, writable, and enumerable data descriptor",
    );
  }
}

/**
 * `String(value)`, except that a symbol is refused.
 *
 * Every other value has a string form that means something; a symbol's does
 * not, and `String(symbol)` throws anyway. Refusing here rather than letting
 * the coercion throw makes the error say which side was wrong.
 */
function toEnvString(value: unknown, what: string): string {
  if (typeof value === "symbol") {
    throw new TypeError(`Cannot convert a Symbol ${what} to a string`);
  }
  return String(value);
}

export const env: Record<string, string | undefined> = new Proxy(
  // The target is empty and stays empty -- every trap answers from the real
  // environment, and a target that shadowed it would let the two disagree --
  // but it is an ordinary object rather than a null-prototype one. Node's
  // `process.env` inherits from `Object.prototype`, so `process.env.toString`
  // is a function, and code that reaches for `process.env.hasOwnProperty`
  // finds one. Setting a variable of that name shadows it, which is the
  // behaviour node has and node's own test asserts.
  {} as Record<string, string | undefined>,
  {
    get(_target, property): string | undefined {
      // Including the well-known ones: `Object.prototype.toString.call(env)`
      // looks up `Symbol.toStringTag`, and throwing there would make an
      // ordinary inspection fail.
      if (typeof property === "symbol") return undefined;
      if (nts_process_env_has(property)) return nts_process_env(property);
      // Not a variable, so ordinary lookup: the inherited `Object.prototype`
      // members are reachable, and everything else is `undefined`.
      return Reflect.get(_target, property) as string | undefined;
    },

    set(_target, property, value): boolean {
      const name = toEnvString(property, "key");
      nts_process_env_set(name, toEnvString(value, "value"));
      return true;
    },

    has(_target, property): boolean {
      if (typeof property === "symbol") return false;
      return nts_process_env_has(property);
    },

    deleteProperty(_target, property): boolean {
      // True even for a name that was never set, and even for a symbol, which
      // could not have been set at all. `delete` reports "the property is now
      // absent", and it is.
      if (typeof property !== "symbol") nts_process_env_delete(property);
      return true;
    },

    ownKeys(): string[] {
      return nts_process_env_keys();
    },

    getOwnPropertyDescriptor(_target, property): PropertyDescriptor | undefined {
      if (typeof property === "symbol" || !nts_process_env_has(property)) return undefined;
      // Configurable and writable because the environment really is: anything
      // in the process can change it, and saying otherwise would let
      // `Object.freeze` appear to work.
      return {
        value: nts_process_env(property),
        writable: true,
        enumerable: true,
        configurable: true,
      };
    },

    defineProperty(_target, property, descriptor): boolean {
      requireDataDescriptor(descriptor);
      const name = toEnvString(property, "key");
      nts_process_env_set(name, toEnvString(descriptor.value, "value"));
      return true;
    },
  },
);
