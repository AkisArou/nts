// `deprecate`'s wrapper, `debuglog`'s `enabled`, and the `port` key on a socket error.
//
// Three divergences from one differential spec, and each is a *shape* rather than a
// value -- the thing a caller reads off the object, which is why none of them
// showed up in any test that only checked what a function returns.
//
// 1. `deprecate` returned a plain closure. Node builds the wrapper deliberately:
//    it copies the `length` descriptor, sets the original as the wrapper's
//    prototype, forwards `prototype`, and constructs through `Reflect.construct`
//    with `new.target`. Without those, arity read 0 for a two-parameter function,
//    `new Wrapped(x) instanceof fn` was false, and wrapping a `class` **threw** --
//    "Class constructor K cannot be invoked without 'new'" -- because `fn.apply`
//    does not construct. That last one worked for ordinary constructor functions
//    only by accident: `this` is already the new object, so a body that assigns to
//    `this` appears to succeed.
//
// 2. `debuglog(section).enabled` was `undefined` where node answers `false`. Node
//    publishes it as an enumerable configurable getter, and it is the documented
//    way to skip building an expensive message. A truthiness test survived by
//    luck, since `undefined` is falsy -- the disabled case behaved and the enabled
//    case would not have.
//
// 3. A socket error carried an own `port` key holding `undefined` when there was
//    no port. Node assigns `address` unconditionally and guards the port with
//    `if (port)`, so `Object.keys` differs and `"port" in error` differs.
//
// The third has a second lesson worth the space. The guard was **already there**
// and already correct, and fixing it required not touching it: with
// `useDefineForClassFields`, a bare `port?: number;` field declaration emits a
// definition, so the key existed before the constructor ran. The guard was
// measured doing nothing first. `declare port?: number;` emits nothing and leaves
// the guard as the only thing that creates the key.
//
// And the same defect sat in two places -- `util/src/main.ts`'s `ErrnoException`
// and `internal/uv.ts`'s `UVAddressError`, two implementations of one node class.
// The first probe pointed at the wrong one, fixed it, and the divergence did not
// move.
"use strict";

const assert = require("assert");
const util = require("util");

// ---- 1. the deprecation wrapper -------------------------------------------

const plain = (a, b) => `${a}:${b}`;
const wrapped = util.deprecate(plain, "plain is deprecated", "DEP9001");
assert.strictEqual(wrapped.length, 2, "the wrapper must keep the original's arity");
assert.strictEqual(wrapped.name, "deprecated", "node names the wrapper `deprecated`");
assert.strictEqual(wrapped("a", "b"), "a:b", "and must still answer what the original does");
assert.strictEqual(
  Object.getPrototypeOf(wrapped), plain,
  "node sets the original as the wrapper's prototype",
);

// A `class` is the case that threw rather than answering wrongly.
class Wrapped { constructor(v) { this.v = v; } }
const WrappedClass = util.deprecate(Wrapped, "class is deprecated", "DEP9002");
const built = new WrappedClass(7);
assert.strictEqual(built.v, 7, "the wrapper must construct a class, not apply it");
assert.ok(built instanceof Wrapped, "and the instance must be one of the original");
assert.strictEqual(WrappedClass.prototype, Wrapped.prototype, "`prototype` is forwarded");

// An ordinary constructor function, which is the arm that passed by accident.
function Ctor(v) { this.v = v; }
Ctor.prototype.tag = function tag() { return "t"; };
const WrappedCtor = util.deprecate(Ctor, "ctor is deprecated", "DEP9003");
const madeByCtor = new WrappedCtor(3);
assert.strictEqual(madeByCtor.v, 3);
assert.ok(madeByCtor instanceof Ctor, "`new Wrapped(x) instanceof fn` must hold");
assert.strictEqual(madeByCtor.tag(), "t", "the original prototype's methods must be reachable");

// `new.target` is forwarded, so a subclass of the wrapper gets its own prototype.
class Sub extends WrappedCtor {}
const sub = new Sub(4);
assert.ok(sub instanceof Sub, "new.target must reach Reflect.construct");
assert.ok(sub instanceof Ctor);

// ---- 2. debuglog's `enabled` ----------------------------------------------

// A section nobody enables, so this asserts the disabled shape rather than the
// contents of `NODE_DEBUG`, which is a fact about the environment and not the
// input. The *shape* is what was missing.
const log = util.debuglog("nts-helper-shapes-never-enabled");
assert.strictEqual(typeof log, "function");
assert.strictEqual(log.enabled, false, "`enabled` must exist and be false, not undefined");
const descriptor = Object.getOwnPropertyDescriptor(log, "enabled");
assert.ok(descriptor !== undefined, "`enabled` must be an own property");
assert.strictEqual(typeof descriptor.get, "function", "node publishes it as a getter");
assert.strictEqual(descriptor.enumerable, true);
assert.strictEqual(descriptor.configurable, true);
assert.strictEqual(log("ignored"), undefined, "a disabled logger answers undefined");
assert.strictEqual(util.debug, util.debuglog, "`debug` is the same function value");

// ---- 3. the `port` key on a socket error ----------------------------------

const noPort = util._exceptionWithHostPort(-2, "bind", "1.2.3.4", 0);
assert.strictEqual(
  Object.keys(noPort).sort().join(","), "address,code,errno,syscall",
  "a port of 0 must not leave an own `port` key",
);
assert.strictEqual("port" in noPort, false, "and `in` must agree with `Object.keys`");
assert.strictEqual(noPort.address, "1.2.3.4", "`address` is assigned unconditionally");

const withPort = util._exceptionWithHostPort(-2, "bind", "1.2.3.4", 8080);
assert.strictEqual(
  Object.keys(withPort).sort().join(","), "address,code,errno,port,syscall",
  "a real port must be an own key",
);
assert.strictEqual(withPort.port, 8080);
assert.strictEqual(withPort.message, "bind ENOENT 1.2.3.4:8080");

// `undefined` rather than 0, which is the other way to have no port.
const noPortAtAll = util._exceptionWithHostPort(-2, "getsockname", undefined, undefined);
assert.strictEqual("port" in noPortAtAll, false);
assert.strictEqual(noPortAtAll.message, "getsockname ENOENT");
