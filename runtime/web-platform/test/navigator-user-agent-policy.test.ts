import assert from "node:assert/strict";
import test from "node:test";
import { Navigator, createNavigator } from "../src/navigator/navigator.ts";
import type { NavigatorCapability } from "../src/provider/navigator.ts";

class UserAgentCapability implements NavigatorCapability {
  value: string;
  calls: number = 0;

  constructor(value: string) { this.value = value; }

  userAgent(): string {
    this.calls++;
    return this.value;
  }
}

// HTML 8.10.1: Navigator has no public Web IDL constructor.
// https://html.spec.whatwg.org/multipage/system-state.html#the-navigator-object
test("Navigator has no public construction operation", () => {
  assert.equal(Navigator.name, "Navigator");
  assert.equal(Navigator.length, 0);
  assert.throws(() => new Navigator(), TypeError);
});

test("Navigator rejects an unrelated internal construction key before reading the provider", () => {
  const capability = new UserAgentCapability("unread");
  assert.throws(() => {
    // @ts-expect-error A user-created symbol is not the unexported construction key.
    return new Navigator(Symbol("Navigator constructor"), capability);
  }, TypeError);
  assert.equal(capability.calls, 0);
});

test("Navigator subclass construction cannot bypass the public-constructor refusal", () => {
  class DerivedNavigator extends Navigator {}
  assert.throws(() => new DerivedNavigator(), TypeError);
});

test("createNavigator creates the canonical branded interface without reading the environment", () => {
  const capability = new UserAgentCapability("Conformance/1.0");
  const navigator = createNavigator(capability);
  assert.ok(navigator instanceof Navigator);
  assert.equal(navigator[Symbol.toStringTag], "Navigator");
  assert.equal(Object.prototype.toString.call(navigator), "[object Navigator]");
  assert.equal(capability.calls, 0);
});

// HTML 8.10.1.1: return this object's relevant settings object's environment
// default User-Agent value. The source getter does not compose or normalize it.
// https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-useragent
for (const [name, value] of [
  ["a configured product string", "Conformance/1.0"],
  ["an empty configured string without a fallback", ""],
  ["the configured bytes and whitespace", "Conformance/1.0 (fixture; \u00e9)  "],
] as const) {
  test(`Navigator.userAgent returns ${name} exactly`, () => {
    const capability = new UserAgentCapability(value);
    assert.equal(createNavigator(capability).userAgent, value);
    assert.equal(capability.calls, 1);
  });
}

test("Navigator.userAgent performs one provider call per read and does not cache a stale value", () => {
  const capability = new UserAgentCapability("First/1");
  const navigator = createNavigator(capability);
  assert.equal(navigator.userAgent, "First/1");
  assert.equal(capability.calls, 1);
  capability.value = "Second/2";
  assert.equal(navigator.userAgent, "Second/2");
  assert.equal(capability.calls, 2);
});

test("Navigator.userAgent preserves the provider method receiver", () => {
  const capability: NavigatorCapability = {
    userAgent() {
      assert.equal(this, capability);
      return "Receiver/1";
    },
  };
  assert.equal(createNavigator(capability).userAgent, "Receiver/1");
});

test("Navigator instances read their own environment rather than shared process state", () => {
  const first = new UserAgentCapability("EnvironmentA/1");
  const second = new UserAgentCapability("EnvironmentB/2");
  const a = createNavigator(first);
  const b = createNavigator(second);
  assert.notEqual(a, b);
  assert.equal(a.userAgent, "EnvironmentA/1");
  assert.equal(b.userAgent, "EnvironmentB/2");
  second.value = "EnvironmentB/3";
  assert.equal(a.userAgent, "EnvironmentA/1");
  assert.equal(b.userAgent, "EnvironmentB/3");
  assert.equal(first.calls, 2);
  assert.equal(second.calls, 2);
});

// Node-only test glue extracts the getter to test Web IDL receiver branding.
// No source implementation reflects over a descriptor or prototype.
const getUserAgent = Object.getOwnPropertyDescriptor(Navigator.prototype, "userAgent")!.get!;

test("Navigator.userAgent rejects unbranded receivers before consulting a provider", () => {
  let reads = 0;
  const apparentNavigator = {
    get capability() { reads++; throw new Error("public property must not be read"); },
    get userAgent() { reads++; throw new Error("public property must not be read"); },
  };
  for (const receiver of [undefined, null, false, 0, "", Symbol(), {},
    Navigator.prototype, Object.create(Navigator.prototype), apparentNavigator]) {
    assert.throws(() => getUserAgent.call(receiver), TypeError);
  }
  assert.equal(reads, 0);
});

test("a borrowed Navigator.userAgent getter uses the branded receiver's environment", () => {
  const first = new UserAgentCapability("A/1");
  const second = new UserAgentCapability("B/2");
  const a = createNavigator(first);
  const b = createNavigator(second);
  assert.equal(getUserAgent.call(b), "B/2");
  assert.equal(first.calls, 0);
  assert.equal(second.calls, 1);
  assert.equal(getUserAgent.call(a), "A/1");
  assert.equal(first.calls, 1);
});

test("Navigator.userAgent is a readonly getter", () => {
  const capability = new UserAgentCapability("ReadOnly/1");
  const navigator = createNavigator(capability);
  assert.throws(() => {
    // @ts-expect-error The public attribute is readonly.
    navigator.userAgent = "override";
  }, TypeError);
  assert.equal(navigator.userAgent, "ReadOnly/1");
  assert.equal(capability.calls, 1);
});

test("createNavigator requires an explicit provider and never supplies a platform default", () => {
  assert.throws(() => {
    // @ts-expect-error Bootstrap must supply the typed provider capability.
    return createNavigator();
  }, TypeError);
});
