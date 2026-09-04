// The native half of `node:http`, for the node-side run only.
//
// There is none of its own, and that is the point of this module: HTTP is a
// text protocol over a socket, so once `node:net` provides the socket there is
// nothing left that needs the operating system. The parser is TypeScript here
// rather than a binding to llhttp, which is why a passing `http` test is this
// code parsing rather than a C library's.
import "../internal/bindings.node.mjs";
import "../net/bindings.node.mjs";
import "../stream/bindings.node.mjs";
