const kHighWaterMark = Symbol("kHighWaterMark");
let maxIdleHTTPParsers = 1000;

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

/**
 * Native TypeScript records already have dictionary shape. The Node-hosted
 * conformance lane also needs Node's observable null-prototype dictionaries;
 * that host object-model detail belongs here rather than in runtime source.
 */
function nullPrototypeProperty(Class, name, rawName) {
  const descriptor = Object.getOwnPropertyDescriptor(Class.prototype, name);
  if (typeof descriptor?.get !== "function" || typeof descriptor.set !== "function") return;
  const read = descriptor.get;
  const write = descriptor.set;
  Object.defineProperty(Class.prototype, name, {
    ...descriptor,
    get() {
      const current = read.call(this);
      if (Object.getPrototypeOf(current) === null) return current;
      const shaped = Object.assign(Object.create(null), current);
      if (!Object.hasOwn(shaped, "__proto__")) {
        const raw = this[rawName];
        for (let index = 0; index < raw.length; index += 2) {
          if (raw[index].toLowerCase() !== "__proto__") continue;
          const existing = shaped.__proto__;
          if (Array.isArray(existing)) existing.push(raw[index + 1]);
          else shaped.__proto__ = [raw[index + 1]];
        }
      }
      write.call(this, shaped);
      return shaped;
    },
  });
}

function nullPrototypeResult(Class, name) {
  const original = Class.prototype[name];
  if (typeof original !== "function") return;
  Object.defineProperty(Class.prototype, name, {
    configurable: true,
    writable: true,
    value: function (...args) {
      const shaped = Object.assign(Object.create(null), original.apply(this, args));
      if (!Object.hasOwn(shaped, "__proto__") && this.hasHeader("__proto__")) {
        shaped.__proto__ = this.getHeader("__proto__");
      }
      return shaped;
    },
  });
}

const requestOptionNames = [
  "href",
  "host",
  "hostname",
  "port",
  "path",
  "protocol",
  "method",
  "headers",
  "auth",
  "agent",
  "defaultPort",
  "timeout",
  "setHost",
  "setDefaultHeaders",
  "uniqueHeaders",
  "joinDuplicateHeaders",
  "httpValidation",
  "insecureHTTPParser",
  "createConnection",
  "lookup",
  "localAddress",
  "localPort",
  "family",
  "hints",
  "socketPath",
  "signal",
  "maxHeaderSize",
];

// In `request(url, options)`, only location fields the caller actually supplied
// override the URL. Synthetic `undefined` fields still mask prototype pollution
// everywhere else, but must not erase the location parsed from the first argument.
const urlLocationOptionNames = new Set(["host", "hostname", "port", "path", "protocol", "auth"]);

function requestOptions(options, preserveUrlLocation = false) {
  if (options === null || typeof options !== "object") return options;
  const shaped = Object.assign(Object.create(null), options);
  if (options instanceof URL) shaped.href = options.href;
  const derivesLocationFromHref = preserveUrlLocation || typeof shaped.href === "string";
  for (const name of requestOptionNames) {
    if (name in shaped) continue;
    if (derivesLocationFromHref && urlLocationOptionNames.has(name)) continue;
    shaped[name] = undefined;
  }
  return shaped;
}

function optionsSupplyUrlLocation(options) {
  return (
    typeof options === "string" ||
    options instanceof URL ||
    (options !== null && typeof options === "object" && typeof options.href === "string")
  );
}

function requestConstructor(Class) {
  const shaped = function (options, callback) {
    const target = new.target === shaped ? Class : new.target;
    return Reflect.construct(Class, [requestOptions(options), callback], target);
  };
  Object.setPrototypeOf(shaped, Class);
  shaped.prototype = Class.prototype;
  Object.defineProperty(shaped, "name", { value: "ClientRequest" });
  return shaped;
}

export function shape(exports) {
  // NTS represents this private slot as a fixed typed field. The symbol is
  // only Node's host-facing spelling, so the mapping remains in this facade.
  Object.defineProperty(exports.OutgoingMessage.prototype, kHighWaterMark, {
    configurable: true,
    get() {
      return this._highWaterMark;
    },
  });
  nullPrototypeProperty(exports.IncomingMessage, "headersDistinct", "rawHeaders");
  nullPrototypeProperty(exports.IncomingMessage, "trailersDistinct", "rawTrailers");
  nullPrototypeResult(exports.OutgoingMessage, "getHeaders");
  const http = { ...exports };
  delete http.default;
  http.Agent = callableConstructor(exports.Agent, "Agent");
  http.ClientRequest = requestConstructor(exports.ClientRequest);
  http.Server = callableConstructor(exports.Server, "Server");
  http.setMaxIdleHTTPParsers = (max) => {
    exports.setMaxIdleHTTPParsers(max);
    maxIdleHTTPParsers = max;
  };
  http.request = (options, optionsOrCallback, callback) => {
    const preserveUrlLocation = optionsSupplyUrlLocation(options);
    return exports.request(
      requestOptions(options),
      requestOptions(optionsOrCallback, preserveUrlLocation),
      callback,
    );
  };
  http.get = (options, optionsOrCallback, callback) => {
    const preserveUrlLocation = optionsSupplyUrlLocation(options);
    return exports.get(
      requestOptions(options),
      requestOptions(optionsOrCallback, preserveUrlLocation),
      callback,
    );
  };
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
    _http_agent: {
      Agent: exports.Agent,
      globalAgent: exports.globalAgent,
    },
    _http_common: {
      HTTPParser,
      methods: exports.methods,
      parsers: {
        get max() {
          return maxIdleHTTPParsers;
        },
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
    _http_outgoing: {
      kHighWaterMark,
    },
    "internal/options": {
      getOptionValue(name) {
        return name === "--max-http-header-size" ? exports.maxHeaderSize : undefined;
      },
    },
  };
}
