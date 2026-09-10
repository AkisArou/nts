"use strict";

// An HTTP/1.0 response does not keep the connection alive by default.
//
// Node clears `shouldKeepAlive` in the same branch that decides chunked
// encoding, and this did not:
//
//     request           node                        here, before
//     1.0 no te         chunked=false keepAlive=false   keepAlive=TRUE
//     1.0 te:chunked    chunked=true  keepAlive=false   keepAlive=TRUE
//
// It matters at the protocol level rather than as a field value. HTTP/1.0 has no
// chunked encoding, so a response with no `content-length` is delimited by the
// connection closing -- and answering `Connection: keep-alive` to a 1.0 peer
// leaves it with no way to know where the body ends.
//
// Nothing upstream asserts it. Node's own tests drive a real server, so a 1.0
// request reaches this constructor through the parser with headers attached;
// building a `ServerResponse` by hand is the only way to see the default, and on
// node the branch cannot be got wrong.
//
// The fourth case is the one that found it: `new ServerResponse({ method: "GET" })`
// threw here and node accepts it. Node reads `req.headers.te` *only* inside the
// version branch, and `undefined < 1` is false, so a request with no `headers`
// never reaches the read.

require("../common");
const assert = require("assert");
const http = require("http");

const shape = (req) => {
  const response = new http.ServerResponse(req);
  return [response.useChunkedEncodingByDefault, response.shouldKeepAlive];
};

assert.deepStrictEqual(
  shape({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1, headers: {} }),
  [true, true],
  "1.1 keeps both defaults",
);
assert.deepStrictEqual(
  shape({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 0, headers: {} }),
  [false, false],
  "1.0 without TE: no chunking and no keep-alive",
);
assert.deepStrictEqual(
  shape({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 0, headers: { te: "chunked" } }),
  [true, false],
  "1.0 advertising TE: chunking, and still no keep-alive",
);

// A request object with no `headers` at all, which node tolerates.
assert.deepStrictEqual(
  shape({ method: "GET" }),
  [true, true],
  "an unversioned request must not reach the headers read",
);
