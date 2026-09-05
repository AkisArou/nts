function callableConstructor(Class, name) {
  const callable = function (...args) {
    if (new.target === undefined) return new Class(...args);
    return Reflect.construct(Class, args, new.target === callable ? Class : new.target);
  };
  Object.setPrototypeOf(callable, Class);
  callable.prototype = Class.prototype;
  Object.defineProperty(callable, "name", { value: name });
  return callable;
}

export function shape(exports) {
  const http = { ...exports };
  delete http.default;
  http.Agent = callableConstructor(exports.Agent, "Agent");
  http.Server = callableConstructor(exports.Server, "Server");
  return http;
}

/**
 * Node's private `_http_common` view of the parser.
 *
 * The native parser stores callbacks in numeric slots. The profile parser
 * names those callbacks so compiled TypeScript has a fixed, checked layout;
 * this Node-only adapter translates the private numeric convention at the
 * conformance boundary without putting dynamic properties in runtime source.
 */
function internalHTTPParser(RawHTTPParser) {
  const callbacks = new WeakMap();

  class HTTPParser extends RawHTTPParser {
    initialize(type, resource, maxHeaderSize) {
      const limit = typeof resource === "number" ? resource : maxHeaderSize;
      super.initialize(type, typeof limit === "number" ? limit : undefined);
    }
  }

  const callbackNames = [
    "onMessageBegin",
    "onHeaders",
    "onHeadersComplete",
    "onBody",
    "onMessageComplete",
  ];

  for (let index = 0; index < callbackNames.length; index++) {
    const name = callbackNames[index];
    Object.defineProperty(HTTPParser.prototype, index, {
      configurable: true,
      get() {
        return callbacks.get(this)?.[index] ?? null;
      },
      set(callback) {
        let slots = callbacks.get(this);
        if (slots === undefined) {
          slots = new Array(callbackNames.length).fill(null);
          callbacks.set(this, slots);
        }
        slots[index] = callback;
        if (index === 2 && typeof callback === "function") {
          this[name] = function headersComplete(info) {
            return callback.call(
              this,
              info.versionMajor,
              info.versionMinor,
              info.headers,
              info.method,
              info.url,
              info.statusCode,
              info.statusMessage,
              info.upgrade,
              info.shouldKeepAlive,
            );
          };
        } else {
          this[name] = callback;
        }
      },
    });
  }

  HTTPParser.kOnMessageBegin = 0;
  HTTPParser.kOnHeaders = 1;
  HTTPParser.kOnHeadersComplete = 2;
  HTTPParser.kOnBody = 3;
  HTTPParser.kOnMessageComplete = 4;
  HTTPParser.kOnExecute = 5;
  HTTPParser.kOnTimeout = 6;
  return HTTPParser;
}

export function internals(exports) {
  const HTTPParser = internalHTTPParser(exports.HTTPParser);
  return {
    _http_common: {
      HTTPParser,
      methods: exports.methods,
      parsers: {
        alloc() {
          return new HTTPParser();
        },
      },
      freeParser(parser) {
        parser.free();
      },
      _checkInvalidHeaderChar: exports.checkInvalidHeaderChar,
      _checkIsHttpToken: exports.checkIsHttpToken,
    },
  };
}
