import assert from "node:assert/strict";
import { test } from "node:test";
import { HOST_INFRASTRUCTURE, hostEnvironment, programHost } from "../canonical-environment.ts";
import { systemdEnvironment } from "../environment.ts";

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
  assert.notDeepEqual(programHost(host), programHost({ ...host, PATH: "/different-tools" }));
  assert.notDeepEqual(programHost(host), programHost({ ...host, JAVA_HOME: "/different-jdk" }));
});
