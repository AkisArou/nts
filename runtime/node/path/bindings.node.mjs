// `node:path` uses only the shared process cwd/environment bindings. Importing
// their stand-ins here mirrors the compiled link against `internal/process.c`;
// redefining them per module would create two implementations of one ABI.
import "../internal/bindings.node.mjs";
