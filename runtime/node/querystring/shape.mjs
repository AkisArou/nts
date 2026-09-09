// The object node's tests see as `require('querystring')`.
//
// It is `QueryString` itself, not a copy: `parse` reads `unescape` off that
// object at call time, so a test that replaces `querystring.unescape` must be
// replacing the property `parse` will read. A spread would give the test one
// object and `parse` another.
export function shape(exports) {
  const qs = exports.QueryString;
  // A compiled module may not publish `QueryString` yet, and reaching through
  // an absent export turns "one export is missing" into "the module did not
  // load" -- one message for every test in the module, naming nothing. Every
  // test still fails; they fail saying which export they wanted.
  //
  // **It used to return `{}` and that threw away everything else.** The
  // compiled `querystring` publishes `escape`, which is node's and answers
  // exactly what node answers -- `a b` to `a%20b`, `a+b` to `a%2Bb`, the emoji
  // to `%F0%9F%98%80` -- and the shape discarded it because `QueryString` is
  // absent. `hidden-exports.mjs` reported it as `NOT PUBLIC escape: function`.
  //
  // Third time for this shape: `stream` and `process` carry the same
  // correction, and `os/shape.mjs` records the throwing version of it. The
  // guard is right and its scope was wrong.
  if (qs === undefined) {
    const partial = {};
    for (const [name, value] of Object.entries(exports)) {
      if (name === "default" || name === "QueryString") continue;
      partial[name] = value;
    }
    return partial;
  }
  const compiledParse = qs.parse;

  // NTS records have no prototype chain. N-API and the direct TypeScript
  // lane necessarily materialize them as ordinary JavaScript objects, so
  // restore Node's observable null-prototype result at the host boundary.
  // This is representation shaping only; parsing remains in TypeScript.
  function parse(query, separator, equals, options) {
    const result = compiledParse(query, separator, equals, options);
    Object.setPrototypeOf(result, null);
    return result;
  }

  qs.parse = parse;
  qs.decode = parse;
  qs.encode = qs.stringify;
  return qs;
}
