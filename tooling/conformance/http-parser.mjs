// The HTTP/1.1 parser, against messages built by hand.
//
//   node tooling/conformance/http-parser.mjs
//
// Node's parser is llhttp, a C library, so there is nothing to run a
// differential against without binding to the thing being tested. These are
// transcribed from RFC 9112 instead: the framing rules, the two refusals that
// prevent request smuggling, and -- the case a whole-message test cannot reach
// -- the same messages delivered a byte at a time.
//
// Every one of these was checked by breaking the parser and confirming the
// suite went red. Three did not, the first time. Two asserted only the error
// *code*, and the specific header checks share a code with the general one, so
// removing either left the code unchanged; they assert the reason now. The
// third was a sabotage that turned out to be a no-op -- it disabled the branch
// whose contents it was editing -- which is its own reminder that a sabotage
// has to be checked as carefully as the code it is testing.
//
// It was then checked against *absence* rather than only against breakage,
// which is a different and stronger question: not "does this notice when the
// code is wrong" but "does it notice when the code is not there". A parser
// whose `execute` returns the length and does nothing else leaves 3 of 26
// passing; one that never reports a body, 21; one that never reports a
// completed message, 19; one that never reports headers, 18. A suite that a
// no-op implementation can satisfy is measuring the harness.


const { HTTPParser, REQUEST, RESPONSE } = await import(
  new URL("../../runtime/node/http/src/parser.ts", import.meta.url).pathname,
);

function drive(type, text, { split = 0, skipBody = false } = {}) {
  const p = new HTTPParser();
  p.initialize(type);
  p.skipBody = skipBody;
  const seen = { headers: null, body: [], complete: 0 };
  p.onHeadersComplete = (i) => { seen.headers = i; };
  p.onBody = (c) => seen.body.push(Buffer.from(c).toString("latin1"));
  p.onMessageComplete = () => { seen.complete++; };

  const bytes = Buffer.from(text, "latin1");
  let n = 0;
  if (split > 0) {
    for (let i = 0; i < bytes.length; i += split) {
      const r = p.execute(bytes.subarray(i, Math.min(i + split, bytes.length)));
      if (r < 0) return { error: p.error, seen };
      n += r;
    }
  } else {
    const r = p.execute(bytes);
    if (r < 0) return { error: p.error, seen };
    n = r;
  }
  return { n, seen, error: p.error };
}

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; } else { fail++; console.log("  FAIL", name, extra ?? ""); }
};

// A plain request with a body.
{
  const { seen } = drive(REQUEST, "POST /x HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\n\r\nhello");
  check("request method", seen.headers?.method === HTTPParser.methods.indexOf("POST"));
  check("request url", seen.headers?.url === "/x");
  check("request headers", JSON.stringify(seen.headers?.headers) === '["Host","a","Content-Length","5"]');
  check("request body", seen.body.join("") === "hello", seen.body);
  check("request complete", seen.complete === 1);
  check("keep-alive", seen.headers?.shouldKeepAlive === true);
}

// The same, one byte at a time.
{
  const { seen } = drive(REQUEST, "POST /x HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\n\r\nhello", { split: 1 });
  check("byte-at-a-time body", seen.body.join("") === "hello", seen.body);
  check("byte-at-a-time complete", seen.complete === 1);
}

// Chunked.
{
  const { seen } = drive(RESPONSE,
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n");
  check("chunked body", seen.body.join("") === "hello world", seen.body);
  check("chunked complete", seen.complete === 1);
  check("status", seen.headers?.statusCode === 200 && seen.headers?.statusMessage === "OK");
}

// Chunked, split mid-size and mid-data.
{
  const { seen } = drive(RESPONSE,
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n", { split: 3 });
  check("chunked split body", seen.body.join("") === "hello world", seen.body);
  check("chunked split complete", seen.complete === 1);
}

// HEAD: Content-Length present, no body follows.
{
  const { seen } = drive(RESPONSE, "HTTP/1.1 200 OK\r\nContent-Length: 42\r\n\r\n", { skipBody: true });
  check("HEAD no body", seen.body.length === 0);
  check("HEAD complete", seen.complete === 1);
}

// Smuggling: both framings.
{
  const { error } = drive(REQUEST,
    "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n");
  check("both framings refused", error?.code === "HPE_UNEXPECTED_CONTENT_LENGTH", error);
}

// Smuggling: space before the colon.
{
  const { error } = drive(REQUEST, "GET / HTTP/1.1\r\nContent-Length : 5\r\n\r\n");
  check("space before colon refused", error?.reason === "Whitespace before colon", error);
}

// Obsolete line folding.
{
  const { error } = drive(REQUEST, "GET / HTTP/1.1\r\nHost: a\r\n b\r\n\r\n");
  check("obs-fold refused", error?.reason === "Obsolete line folding", error);
}

// A request with no framing has no body: the next request is not our body.
{
  const p = new HTTPParser();
  p.initialize(REQUEST);
  let completes = 0;
  const bodies = [];
  p.onBody = (c) => bodies.push(Buffer.from(c).toString());
  p.onMessageComplete = () => { completes++; p.continueAfterMessage(); };
  const text = "GET /a HTTP/1.1\r\nHost: h\r\n\r\nGET /b HTTP/1.1\r\nHost: h\r\n\r\n";
  const buf = Buffer.from(text);
  let off = 0;
  while (off < buf.length) {
    const r = p.execute(buf.subarray(off));
    if (r <= 0) break;
    off += r;
  }
  check("two pipelined requests", completes === 2, completes);
  check("no phantom body", bodies.length === 0, bodies);
}

// Connection: close on 1.1
{
  const { seen } = drive(REQUEST, "GET / HTTP/1.1\r\nConnection: close\r\n\r\n");
  check("connection close", seen.headers?.shouldKeepAlive === false);
}

// HTTP/1.0 defaults to closing.
{
  const { seen } = drive(REQUEST, "GET / HTTP/1.0\r\n\r\n");
  check("1.0 closes", seen.headers?.shouldKeepAlive === false);
  check("1.0 version", seen.headers?.versionMinor === 0);
}

// Response with no framing reads until close.
{
  const p = new HTTPParser();
  p.initialize(RESPONSE);
  const bodies = [];
  let complete = 0;
  p.onBody = (c) => bodies.push(Buffer.from(c).toString());
  p.onMessageComplete = () => { complete++; };
  p.execute(Buffer.from("HTTP/1.1 200 OK\r\n\r\nsome body"));
  check("until-close body before end", bodies.join("") === "some body", bodies);
  check("until-close not yet complete", complete === 0);
  p.finish();
  check("until-close completes at EOF", complete === 1);
}

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail > 0 ? 1 : 0;
