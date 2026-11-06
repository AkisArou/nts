import assert from "node:assert/strict";
import { test } from "node:test";
import { HOST_INFRASTRUCTURE, hostEnvironment, programHost } from "../canonical-environment.ts";
import { systemdEnvironment } from "../environment.ts";
import { comparisonHost } from "../../lanes/resource-comparison.ts";
import { retryInstruments, type Attempt } from "../../lanes/instrument-retry.ts";
import { mergeGateRetry } from "../../lanes/gate-retry.ts";

test("bus capabilities are passed by name while verdict host identity excludes their values", () => {
  const host = { PATH: "/tools", JAVA_HOME: "/jdk", DBUS_SESSION_BUS_ADDRESS: "unix:path=/owned bus", XDG_RUNTIME_DIR: "/owned runtime" };
  const forwarded = systemdEnvironment(host);
  for (const name of HOST_INFRASTRUCTURE) {
    assert.equal(hostEnvironment(host)[name], host[name]);
    assert.equal(forwarded.filter(value => value.startsWith(`--setenv=${name}=`)).length, 1);
    assert.ok(forwarded.includes(`--setenv=${name}=${host[name]}`));
    assert.equal(Object.hasOwn(programHost(host), name), false);
  }
  const changed = { ...host, DBUS_SESSION_BUS_ADDRESS: "unix:path=/another bus", XDG_RUNTIME_DIR: "/another runtime" };
  assert.deepEqual(programHost(host), programHost(changed));
  const key = (value: typeof host) => comparisonHost({ host: value, ambient: { TZ: "UTC" } }, "/run");
  assert.equal(key(host), key(changed));
  assert.notEqual(key(host), key({ ...host, PATH: "/different-tools" }));
  assert.notEqual(key(host), key({ ...host, JAVA_HOME: "/different-jdk" }));
});

test("an infrastructure address change cannot invalidate a complete frozen retry", () => {
  const attempt = (verdict: string, address: string): Attempt => ({ run: "/run", status: 0, summary: {
    requested: ["step"], steps: [{ name: "step", verdict }], identities: { commit: "frozen", nts: { sha256: "binary" } },
    environment: { canonical: true, host: { PATH: "/tools", DBUS_SESSION_BUS_ADDRESS: address, XDG_RUNTIME_DIR: `/runtime/${address}` }, ambient: { TZ: "UTC" } },
  } });
  const first = attempt("INSTRUMENT", "before"), next = attempt("PASS", "after");
  first.summary.steps[0]!.instrument = { kind: "memory-pressure", verdict: "INSTRUMENT" };
  let invocations = 0;
  const result = retryInstruments(first, () => { assert.equal(++invocations, 1); return next; }, () => {});
  assert.equal(result.summary.verdict, "green"); assert.equal(invocations, 1);
  const joined = mergeGateRetry(first, next, ["step"]);
  assert.equal(joined.summary.verdict, "green");
});
