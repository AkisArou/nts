// The object node's tests see as `require('url')`.
//
// Node's module carries both APIs plus the two WHATWG classes, and `Url` is a
// constructor rather than a namespace. `URL` and `URLSearchParams` are also
// globals; unlike `Buffer`, nothing inside node consumes them on our behalf,
// so substituting them is safe and is what the WHATWG tests measure.
const HostURL = globalThis.URL;

export function shape(exports) {
  shapeWhatwgClasses(exports.URL, exports.URLSearchParams);
  return {
    URL: exports.URL,
    URLSearchParams: exports.URLSearchParams,
    Url: exports.Url,
    domainToASCII: exports.domainToASCII,
    domainToUnicode: exports.domainToUnicode,
    fileURLToPath: exports.fileURLToPath,
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

  // Blob URL storage belongs to the embedding Node environment. Preserve its
  // registry operations when installing this profile's URL parser globally.
  for (const name of ["createObjectURL", "revokeObjectURL"]) {
    if (typeof HostURL?.[name] === "function") {
      Object.defineProperty(URL, name, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: HostURL[name],
      });
    }
  }
  makeEnumerableInOrder(URL, ["canParse", "parse"]);
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
