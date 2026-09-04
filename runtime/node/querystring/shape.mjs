// The object node's tests see as `require('querystring')`.
//
// It is `QueryString` itself, not a copy: `parse` reads `unescape` off that
// object at call time, so a test that replaces `querystring.unescape` must be
// replacing the property `parse` will read. A spread would give the test one
// object and `parse` another.
export function shape(exports) {
  const qs = exports.QueryString;
  qs.decode = qs.parse;
  qs.encode = qs.stringify;
  return qs;
}
