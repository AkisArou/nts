Your goal is to close node's conformance gap in `runtime/node`, measured against node's own tests, and to keep every number you publish falsifiable.

**Where it stands, 2026-09-13. A stale number here is a diff, not a re-paste.**

    cluster          86 files: 78 passed, 6 failed, 2 skipped    (42 that morning)
    child_process   119 files: 104 passed, 5 failed, 9 skipped
    compiled axis    46 across 26 modules, emptying arm on every module
    ceiling          21 of 26 modules; five publish nothing compiled because an
                     object/instance/class cannot cross the Node-API boundary

**Work queue, in order.**

1. `cluster`'s remaining 14. Causes are in `runtime/node/cluster/INCOMPLETE.md`.
2. Extra `stdio` slots in `child_process` (`stdio[4]`) — one feature, blocking one file in each of two modules.
3. `test-cluster-net-send.js`: a received host socket delivers no data when the primary's `net` is ours. Fifth realm-seam instance.
4. Do not start `crypto`. Its ADDR is 115, tls 165, http2 248 — that is reach, not yield, and step one is an OpenSSL-class provider binding.

**Method. Each line cost a wrong number to learn.**

- Measure the lane; never add up individual passes. Ten passing files predicted 81 and read 80; another predicted +5 and read +8.
- Diff the pass **set**, not the total. Four up and two down reads as +2 progress.
- `wc -l` both inputs before reading a diff. `/tmp` is a tmpfs and the box rebooted three times on 09-13; a vanished baseline reports "nothing changed".
- Ask what a lane **publishes** before counting its passes. 25 of a 75-file axis asserted nothing.
- A control run on one arm says nothing about the other.
- One message is not one cause. Rank by cause, not by diagnostic text: a six-file error group was three causes.
- A correct fix can need a second correct fix to stand, and the intermediate state is genuinely better and genuinely wrong.
- node is the oracle: measure both ways before asserting what it does.
- Grep a written precondition's words, not its code. Three expired silently this week.
- Events emitted inside the call that produced them: four in one module, wearing a TDZ error, a hang, a mustCall tally and an event nobody heard.

**Operational.**

- Never run `cargo` or `cargo fmt`.
- Copy `target/release/nts` to a scratch pin and pass `NTS_BIN`. Validate the pin against a number you already have; byte-different is not the commit you want.
- `NTS_ADDON_OUT` for addons, never the shared `target/node`.
- `git commit -F <file> -- <paths>`; three sessions share one index. Never switch branches in the shared tree.
- Announce shared-file changes to peers. Importing another module's stand-in is not a way to borrow one binding — it cost two files.
- The shell's `grep` is ugrep; use `/usr/bin/grep` or awk for anything load-bearing. zsh does not word-split unquoted parameters.
- Run unattended. Do not hand back early.

**DONE:** `cluster` at 80 or more of 86, or every remaining file carrying a named cause in `INCOMPLETE.md`; `child_process`'s `stdio[4]` implemented, or refused in writing with the reason; the compiled axis re-measured from today's compiler; and every number above either reproduced or corrected in `docs/conformance/nodejs.md`.
