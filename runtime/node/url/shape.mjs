// The object node's tests see as `require('url')`.
//
// Node's module carries both APIs plus the two WHATWG classes, and `Url` is a
// constructor rather than a namespace. `URL` and `URLSearchParams` are also
// globals; unlike `Buffer`, nothing inside node consumes them on our behalf,
// so substituting them is safe and is what the WHATWG tests measure.
export function shape(exports) {
  shapeWhatwgClasses(exports.URL, exports.URLSearchParams);
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
