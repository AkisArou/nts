// `nts_tty_isatty`, stood in for by node's own.
//
// The interpreted lane therefore tests this module's TypeScript over node's
// handle classification, which for a one-function module is a thin thing to test
// -- the argument guard and nothing else. `uv_guess_handle` is compared only on
// the compiled lane, the same arrangement `zlib` and `dns` record.
import "../internal/bindings.node.mjs";
import { isatty } from "node:tty";

globalThis.nts_tty_isatty = (fd) => isatty(fd);
