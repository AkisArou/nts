# Bind tooling slices to their actual owner (#782)

Tooling and full-check measurement slices were implicit systemd slices. Their
normal process cleanup stopped them, but a killed owner could leave the empty
slice active. The shared transient creator now binds every such slice with
`BindsTo` and `After` to the creating process's actual user-manager scope or
service before its first member starts. Existing gate roots and step slices use
that same creator; their hard limits, job join and cgroup identity checks remain.

Normal cleanup stays explicit. Setup and cleanup retain both causes, and
measurement setup refusals write a hold. A shell without a bindable user-manager
owner receives the exact `systemd-run --user --scope` rerun command. No slice
falls back to being unbound.

The real systemd 262 probe rejected the proposed `StopWhenUnneeded` design:
its empty transient slice stopped and lost its policy before the first member
arrived. That member recreated an implicit slice with the property disabled;
it stayed active after the member stopped. The property could not be changed
through SetUnitProperties on either an implicit or active transient slice.

| Actual manager control | Result |
|---|---|
| Bound empty slice before first member | Active |
| Direct member stopped, nested member still live | Parent and nested slice active |
| Service or scope owner returns normally | Hierarchy inactive; closer ran |
| Service or scope owner SIGKILLed | Hierarchy inactive; closer did not run |
| Unrelated sibling during killed-owner probe | Remained active |

The decisive regression takes the real `runScopedTooling` route in a named
scope and waits for an actual test body before killing its owner by unit name.
One shared experiment runs both current and old owners, then stops only its
recorded owner/slice in finally.

| Same real-route inactive assertion | Old main runner | Fixed runner |
|---|---|---|
| State after owner SIGKILL | `ActiveState=active` | `ActiveState=inactive` |
| `BindsTo` after settling | Empty | Empty after transient unit collection |
| Assertion | Rejected | Passed |

The old module is exactly `63403df66669cc9e5811dc9271bc0b91640ac3bc`'s
`tooling/gate/tooling-runner.ts`, SHA-256
`4c1b5b3015bbeb16790d16fdff061943714d828c030ec96567c046cbf52abbd6`.
The production closure was staged through copyModuleClosure and only that
module was replaced with authenticated old bytes. The fix was committed first;
no active source or shared checkout was changed for the comparison. The old
active state is observed directly, not inferred from a hang timeout.

At proof source `edc0635a90cd877dd80322d5f6735ea058df68a2`, all 66 affected
runner, measurement and scope consumer tests pass with no skips/cancellations;
timing lint, host audit and strict checking pass. The #779 active-stop control
now requires its actual measurement slice inactive. The required inner loop also passes: formatting, Clippy, fresh compiler and backend tests. Actual complete stdout and zero-status terminal rows are retained. The landing service runs the selected complete gate; no extra pre-landing whole-gate run was requested.

The original kernel batch passed 7/7 before timing lint requested the explicit
blocked-sleeper classification. The next passed 8/8 and timing, then host audit
refused two fixture receipt writes; those now use durableRecord or a plain
readiness marker. Final focused 8/8 and all audits are green. These earlier
refusals are retained separately from accepted results.

The historical empty-slice population was cleared by the power-cut reboot, so
its one-time cleanup is moot. No existing foreign or populated slice is stopped
by this change. The control fixtures clean only their own exact unit names.

Raw evidence: `/home/akisarou/.cache/nts-scratch/782/raw-evidence-v1.json`,
SHA-256 `badbc6e06c76eff81be40b28d339791a90fd9a8e6f0fce617f8f5b33520d81bc`.
