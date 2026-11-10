import assert from "node:assert/strict";
import { test } from "node:test";
import { bindsToProperties, ownUnit } from "./bound-slice.ts";

test("ownUnit is the scope or service below the user manager, and nothing else", () => {
  const user = "/user.slice/user-1000.slice/user@1000.service";
  assert.equal(ownUnit(`0::${user}/tmux-spawn-abc.scope`), "tmux-spawn-abc.scope");
  assert.equal(ownUnit(`0::${user}/nts-tooling-x.slice/run-step.scope`), "run-step.scope");
  assert.equal(ownUnit(`0::${user}/nts-full-check.service`), "nts-full-check.service");
  // In a slice, not a unit of its own: nothing to bind to.
  assert.equal(ownUnit(`0::${user}/nts.slice/nts-tooling.slice`), undefined);
  // The user manager's own scope names the manager, not a unit under it.
  assert.equal(ownUnit(`0::${user}`), undefined);
  // Outside a user manager's subtree (a system service, a bare cgroup).
  assert.equal(ownUnit("0::/system.slice/cron.service"), undefined);
  assert.equal(ownUnit("0::/"), undefined);
});

test("bindsToProperties binds and orders the stop, or is empty unbound", () => {
  assert.deepEqual(bindsToProperties("run-step.scope"),
    ["BindsTo", "as", "1", "run-step.scope", "After", "as", "1", "run-step.scope"]);
  assert.deepEqual(bindsToProperties(undefined), []);
});
