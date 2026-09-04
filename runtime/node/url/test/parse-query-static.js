'use strict';

// Applicable parsing behavior retained from pinned upstream
// test-url-parse-query.js. Its helper requires every query result to have a
// null prototype before checking the fields; section 13 uses statically laid
// out records and has no prototype pointer.
const assert = require('assert');
const url = require('url');

{
  const parsed = url.parse('/foo/bar?baz=quux#frag', true);
  assert.strictEqual(parsed.href, '/foo/bar?baz=quux#frag');
  assert.strictEqual(parsed.hash, '#frag');
  assert.strictEqual(parsed.search, '?baz=quux');
  assert.deepStrictEqual(parsed.query, { baz: 'quux' });
  assert.strictEqual(parsed.pathname, '/foo/bar');
  assert.strictEqual(parsed.path, '/foo/bar?baz=quux');
}

{
  const parsed = url.parse('http://example.com', true);
  assert.strictEqual(parsed.href, 'http://example.com/');
  assert.strictEqual(parsed.protocol, 'http:');
  assert.strictEqual(parsed.slashes, true);
  assert.strictEqual(parsed.host, 'example.com');
  assert.strictEqual(parsed.hostname, 'example.com');
  assert.deepStrictEqual(parsed.query, {});
  assert.strictEqual(parsed.search, null);
  assert.strictEqual(parsed.pathname, '/');
  assert.strictEqual(parsed.path, '/');
}

{
  const parsed = url.parse('/example?query=value', true);
  assert.strictEqual(parsed.protocol, null);
  assert.strictEqual(parsed.host, null);
  assert.strictEqual(parsed.port, null);
  assert.strictEqual(parsed.hostname, null);
  assert.strictEqual(parsed.hash, null);
  assert.strictEqual(parsed.search, '?query=value');
  assert.deepStrictEqual(parsed.query, { query: 'value' });
  assert.strictEqual(parsed.pathname, '/example');
  assert.strictEqual(parsed.path, '/example?query=value');
  assert.strictEqual(parsed.href, '/example?query=value');
}
