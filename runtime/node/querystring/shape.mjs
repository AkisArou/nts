// The object node's tests see as `require('querystring')`.
//
// It is `QueryString` itself, not a copy: `parse` reads `unescape` off that
// object at call time, so a test that replaces `querystring.unescape` must be
// replacing the property `parse` will read. A spread would give the test one
// object and `parse` another.
export function shape(exports) {
  const qs = exports.QueryString;
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
