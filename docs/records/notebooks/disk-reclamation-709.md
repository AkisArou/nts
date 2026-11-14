# Ownership-checked disk reclamation — #709

Base `077ebae9a22aacf5ba447bfb4a28f287faab6a46`; frozen proof `527d8b5373234a2f62512eb4b295404eb2d9d4ac`. The [companion](disk-reclamation-709.json)
authenticates 629 artifacts (18,440,162 bytes) and 253 source receipts, including absent base files.

DiskCapacity explicitly reclaims under the shared pool lock before admission and
in upkeep. The measured cold build sizes the trigger and recovery margin.
Only obsolete whole profiles, clean unbuilt Git checkouts and excess free build
output qualify; two warm targets and current service profiles remain. One process
observation owner serves pool reset and deletion. Unreadable tool ownership refuses;
non-dumpable outside-nts processes retain PID, birth and cgroup audit facts.

The actual private scratch pool records obsolete-profile removal (1,052,672
allocated bytes) and later unbuilt-checkout removal (16,384 bytes), after its real
cwd owner drains. Current profiles remain. Its 44 GiB headroom and zero free-space
delta are supplied observations, independent of machine pressure; allocation and
ownership are live. These are no physical disk-savings or performance claims.
The source-authenticated collector-disabled control fails actual beginBuild
admission (status 1), while the unchanged current control passes (status 0).

The five-property unit guard inspects typed WorkingDirectory, RootDirectory and
ExecStartPre/ExecStart/ExecStartPost paths and arguments, including physical alias
and existing-ancestor resolution. An activating start-pre control retains
ExecMainPID=0, direct and outside-alias execution paths, and explicit unit drain.
Systemd 262.1 controls establish D-Bus missing-ok `!` and home `~` forms.
Live full-population checks cost 92.469 ms for 16 services and
64.417 ms for 14 services; these are component observations.
The host audit keeps the owned-unit filter restricted to private controls.

All 167 focused/state/schedule/staging/consumer controls pass,
including real clang-built non-dumpable ownership, corrupt markers, mutation,
previous-boot claims and routine-log suppression. Timing, host and strict pass.
Complete full/unplaced/policy arrays equal the baseline at 178/142/36.

Supported `here-527d8b537323-1794664425756` is canonical with 17 PASS summary steps,
experiments [], cleanup and diagnostics complete. Tooling 2378/0/2 TODO;
native 3047/0/8 ignored. Actual inner --no-agree is green:
fmt 3 s, Clippy 1 s, build 1 s,
tests 302 s. Runner 370.148 s, CLI 374 s,
and separately summed admission 313.049 s retain distinct bases.

The layout-closure refusal, pre-reboot terminal REDs, unreadable-process policy
correction, fixture ownership omission, both supported fixture REDs, typed-unit control RED, audit findings and strict findings remain
separate from accepted proof. The unclean reboot interrupted the work session;
its journals establish which earlier runs had already ended. No source was
half-written on recovery. No extra deletion category is inferred.
