# Private names and a published C symbol

This is the one-export-name control for
`refusal/src/main.ts`. The binding names
`tcgetpgrp` from `<unistd.h>`; publishing a different TypeScript function with
that same C symbol is refused with NTS2007. The control publishes
`free_header_symbol` and discards the native call's result. The build checks
the hard NTS2007 refusal on both emitters before compiling the control.

`build.sh` builds the declared RC library products and emits the raw NoGC
variants. It checks a separate C consumer on C and LLVM against the committed
expected output, compiling each NoGC header witness independently. This is native C behavior;
the JVM's named refusal for the native call is the target boundary.
