# Fixed outcome guard migration

Eleven existing wrong-answer records become agreeing guards. Executable fixture bodies and differential populations are unchanged; source edits are comments identifying the fixes. Each original record is checked against explicit base 7019d580143a6324ed34372878b519ccd960ebc0.

The clean formal pin c69dfaaaead8 is on main, and only documentation separates it from that base. All three official recorder runs have byte-identical outcome blobs, stdout and stderr. Each run checks integrity on all eleven projects. `migration.json` retains old and new observations, source digests, fix commits and full pin provenance.

The first launcher failed before executing node because systemd lacked the shell PATH; its original receipt is preserved. The corrected launcher supplied PATH explicitly. No measurement was accepted from that failed launch.

To remeasure on a later clean main pin, use `NTS_BIN=<pin> node tooling/conformance/outcomes-check.ts --record` with the eleven names in `migration.json`. `measure.py` is the exact retained qualification launcher; its absolute scratch paths describe the original sitting.
