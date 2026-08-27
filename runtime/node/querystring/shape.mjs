// The object node's tests see as `require('querystring')`.
//
// Node's module carries `escape` and `unescape` as *properties it reads back*:
// `parse` compares its decoder against `QueryString.unescape` to decide whether
// a custom one was passed, so a test that replaces `qs.unescape` changes what
// `parse` does. Copying the exports into one object preserves that.
export function shape(exports) {
  return { ...exports };
}
