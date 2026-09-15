// The object node's tests see as `require('url')`.
//
// Node's module carries both APIs plus the two WHATWG classes, and `Url` is a
// constructor rather than a namespace. `URL` and `URLSearchParams` are also
// globals; unlike `Buffer`, nothing inside node consumes them on our behalf,
// so substituting them is safe and is what the WHATWG tests measure.
export function shape(exports) {
  shapeWhatwgClasses(exports.URL, exports.URLSearchParams);
  shapeLegacyQuery(exports.Url);
  return {
    URL: exports.URL,
    URLSearchParams: exports.URLSearchParams,
    Url: exports.Url,
    domainToASCII: exports.domainToASCII,
    domainToUnicode: exports.domainToUnicode,
    fileURLToPath: exports.fileURLToPath,
    fileURLToPathBuffer: exports.fileURLToPathBuffer,
    format: exports.format,
    parse: exports.parse,
    pathToFileURL: exports.pathToFileURL,
    resolve: exports.resolve,
    resolveObject: exports.resolveObject,
    urlToHttpOptions: exports.urlToHttpOptions,
  };
}

/**
 * `url.parse(s, true).query` carries a **null prototype** in node, and must here too.
 *
 * The same correction `querystring/shape.mjs` makes, for the same reason and at the
 * same boundary: an NTS record has no prototype chain, so the compiled module is
 * already right, and it is the N-API and direct-TypeScript lanes that materialise the
 * record as an ordinary object with `Object.prototype`. This is representation
 * shaping only -- the parsing stays in TypeScript.
 *
 * It matters more here than it reads. The object is built from a query string, which
 * is untrusted input, and a plain prototype makes `?__proto__=x` a pollution surface.
 * `querystring.parse` was already shaped; this route was not, because the legacy
 * parser has `this.query = {}` paths of its own that never reach `querystring`.
 *
 * Wrapped on `Url.prototype.parse` rather than on the module function, because both
 * `url.parse(s, true)` and `new url.Url().parse(s, true)` are node's spellings and
 * the module function delegates to the method. An empty query is shaped too: node
 * gives `url.parse("http://h/", true).query` a null prototype as well.
 *
 * Found by running our own tests against node (`NTS_CONFORMANCE_ORACLE=1`), where
 * `url/test/parse-query-static.js` failed on the prototype alone. The differential
 * could not see it: every row rendered the object through `JSON.stringify`, which
 * does not carry a prototype.
 */
function shapeLegacyQuery(Url) {
  if (typeof Url !== "function" || typeof Url.prototype?.parse !== "function") return;
  // Captured under a different name than the wrapper. A *named* function expression
  // binds its own name inside its body, so `function parse` shadowing a `const parse`
  // makes `parse.apply(...)` call itself -- which it did, and every url test that
  // parses died on a stack overflow.
  const original = Url.prototype.parse;
  // Named `parse`, not something descriptive: `Function.prototype.name` is observable
  // and `export-surface-static.js` compares it against node's. A wrapper that renames
  // the function it wraps is a visible difference, and util's surface test caught
  // exactly that on the sibling of this change.
  Url.prototype.parse = function parse(...args) {
    const result = original.apply(this, args);
    const query = this.query;
    if (query !== null && typeof query === "object") Object.setPrototypeOf(query, null);
    return result;
  };
}

export function internals(exports) {
  return {
    "internal/url": {
      isURL: exports.isURL,
    },
  };
}

export function installGlobals(underTest) {
  if (underTest.URL === undefined) {
    delete globalThis.URL;
  } else {
    globalThis.URL = underTest.URL;
  }
  if (underTest.URLSearchParams === undefined) {
    delete globalThis.URLSearchParams;
  } else {
    globalThis.URLSearchParams = underTest.URLSearchParams;
  }
}

/**
 * Web IDL exposes these prototype members as enumerable. TypeScript class
 * members are non-enumerable, so the Node boundary supplies the descriptor
 * shape without putting a property map in the compiled objects themselves.
 */
function shapeWhatwgClasses(URL, URLSearchParams) {
  // A compiled module may not publish this yet. Reaching through an absent
  // export turns "one export is missing" into "the module did not load" -- one
  // message for every test in the module, naming nothing. Returning early lets
  // each test fail saying which export it wanted.
  if (URL === undefined || URLSearchParams === undefined) return;
  makeEnumerableInOrder(URL.prototype, [
    "toString",
    "href",
    "origin",
    "protocol",
    "username",
    "password",
    "host",
    "hostname",
    "port",
    "pathname",
    "search",
    "searchParams",
    "hash",
    "toJSON",
  ]);
  makeEnumerableInOrder(URLSearchParams.prototype, [
    "size",
    "append",
    "delete",
    "get",
    "getAll",
    "has",
    "set",
    "sort",
    "entries",
    "forEach",
    "keys",
    "values",
    "toString",
  ]);

  // These are on **this lane's** `URL` and `URLSearchParams`, not on
  // web-platform's. `runtime/web-platform` has no `URL` class at all -- only
  // `URLSearchParams` -- and its own classes install the tag themselves, in a
  // `static {}` block, as a non-writable non-enumerable configurable data
  // property, which is what WebIDL requires. `runtime/node/url/src/url.ts:36`
  // is where the class shaped here comes from. Recorded because the first
  // version of this note said the opposite and the web-platform lane had to
  // correct it.
  //
  // The three `Symbol.toStringTag` values below are a different act from the
  // enumerability shaping above, and the difference is worth stating because a
  // reader will not see it.
  //
  // Enumerability is a *descriptor* on members the module really defines: the
  // boundary changes how they are described, not whether they exist. A
  // `toStringTag` is a member the compiled module does not define **at all** --
  // there is no `Symbol.toStringTag` in this lowering -- so
  // `Object.prototype.toString.call(new URL(...))` reads `"[object URL]"`
  // because this file says so, and would read it for any object handed to
  // `shape`, including one with no URL behaviour whatever.
  //
  // So a test asserting the tag is evidence about this shim and not about the
  // artifact, in the same way `path.sep` was until it was fixed. It is left in
  // place because there is no other way to produce it today and node's tests
  // read it, but it is named here so nobody counts it as a passing behaviour.
  Object.defineProperty(URL.prototype, Symbol.toStringTag, {
    configurable: true,
    value: "URL",
  });
  Object.defineProperty(URLSearchParams.prototype, Symbol.toStringTag, {
    configurable: true,
    value: "URLSearchParams",
  });

  // Web IDL defines the default iterator as the entries operation itself,
  // including function identity. A second class method would only behave the
  // same; this boundary alias makes it the same function.
  Object.defineProperty(URLSearchParams.prototype, Symbol.iterator, {
    configurable: true,
    writable: true,
    value: URLSearchParams.prototype.entries,
  });

  const iteratorPrototype = Object.getPrototypeOf(new URLSearchParams().entries());
  makeEnumerableInOrder(iteratorPrototype, ["next"]);
  Object.defineProperty(iteratorPrototype, Symbol.toStringTag, {
    configurable: true,
    value: "URLSearchParams Iterator",
  });

  makeEnumerableInOrder(URL, [
    "canParse",
    "parse",
    "createObjectURL",
    "revokeObjectURL",
  ]);
}

function makeEnumerableInOrder(target, names) {
  const descriptors = [];
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    if (descriptor !== undefined) descriptors.push([name, descriptor]);
  }
  for (const [name] of descriptors) delete target[name];
  for (const [name, descriptor] of descriptors) {
    Object.defineProperty(target, name, { ...descriptor, enumerable: true });
  }
}
