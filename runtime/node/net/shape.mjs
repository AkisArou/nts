// The object node's tests see as `require('net')`.

/**
 * `net.Server` and `net.Socket` predate classes and remain callable without
 * `new`. The typed implementation stays as ordinary classes; this facade owns
 * only the legacy CommonJS constructor shape.
 *
 * Sharing the implementation prototype preserves `instanceof` for instances
 * created both here and by `createServer()` / `createConnection()`. Retaining
 * `new.target` preserves normal subclass construction on the Node host.
 */
function callableConstructor(Implementation, name) {
  // A compiled module may not publish this yet. Reaching through an absent
  // export turns "one export is missing" into "the module did not load" -- one
  // message for every test in the module, naming nothing. Returning early lets
  // each test fail saying which export it wanted.
  if (Implementation === undefined) return undefined;
  const callable = function (...args) {
    if (new.target === undefined) return new Implementation(...args);
    return Reflect.construct(
      Implementation,
      args,
      new.target === callable ? Implementation : new.target,
    );
  };
  Object.setPrototypeOf(callable, Implementation);
  callable.prototype = Implementation.prototype;
  Object.defineProperty(callable, "name", { value: name });
  Implementation.prototype.constructor = callable;
  return callable;
}

export function shape(exports) {
  const net = { ...exports };
  const Socket = callableConstructor(exports.Socket, "Socket");
  net.Server = callableConstructor(exports.Server, "Server");
  net.Socket = Socket;
  // Pinned Node exports `Stream` as this exact function object, not as a
  // second wrapper around the same implementation.
  net.Stream = Socket;
  delete net.default;
  return net;
}
