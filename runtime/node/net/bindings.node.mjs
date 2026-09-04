// The native half of `node:net`, for the node-side run only.
//
// A socket is a kernel object either way. Here it is reached through node's
// own `net`, which is the same libuv handles with the same options, so a
// disagreement is about this module's assembly rather than about TCP.
//
// The seam is a handle per connection and per listener, because that is what
// the C side has -- a `uv_tcp_t` -- and because a number crosses the boundary
// where an object cannot.
import "../internal/bindings.node.mjs";
import "../stream/bindings.node.mjs";
import "../timers/bindings.node.mjs";
import net from "node:net";
import { lookup } from "node:dns";
import { Buffer } from "node:buffer";

let nextHandle = 1;
const sockets = new Map();
const servers = new Map();
const boundSockets = new Map();

// Node's test/common scales the attempt timeout by ten for loaded machines.
// This stand-in replaces that common module too, so expose the already-scaled
// value here. The compiled binding returns the runtime's ordinary defaults.
globalThis.nts_net_default_auto_select_family = () => net.getDefaultAutoSelectFamily();
globalThis.nts_net_default_auto_select_family_attempt_timeout = () =>
  net.getDefaultAutoSelectFamilyAttemptTimeout() * 10;

const codeOf = (e) => (typeof e?.errno === "number" ? (e.errno > 0 ? -e.errno : e.errno) : -1);

/** Register a connected socket under an already-chosen numeric handle. */
function adoptAt(handle, socket) {
  // Paused until the module asks: nothing should arrive before `read_start`,
  // or the first chunks are lost before anyone is listening.
  socket.pause();
  const entry = {
    socket,
    reading: false,
    closed: false,
    closeCallback: null,
  };
  socket.once("close", () => {
    entry.closed = true;
    const callback = entry.closeCallback;
    entry.closeCallback = null;
    callback?.();
  });
  sockets.set(handle, entry);
}

/** Register a connected socket and hand back its handle. */
function adopt(socket) {
  const handle = nextHandle++;
  adoptAt(handle, socket);
  return handle;
}

function watchConnect(socket, cb) {
  const onConnect = () => {
    socket.removeListener("error", onError);
    cb(0);
  };
  const onError = (error) => {
    socket.removeListener("connect", onConnect);
    cb(codeOf(error));
  };
  socket.once("connect", onConnect);
  socket.once("error", onError);
}

globalThis.nts_net_connect = (host, port, path, localAddress, localPort, cb) => {
  try {
    // The TypeScript Socket owns Node's public half-open policy. Keep the
    // host transport genuinely half-open so it cannot close the write side
    // behind that state machine when the peer sends FIN.
    const socket = path
      ? net.connect({ path, allowHalfOpen: true })
      : net.connect({
        host,
        port,
        allowHalfOpen: true,
        ...(localAddress ? { localAddress } : {}),
        ...(localPort ? { localPort } : {}),
      });
    const handle = adopt(socket);
    watchConnect(socket, cb);
    return handle;
  } catch (e) {
    return codeOf(e);
  }
};

// Reserve a local TCP endpoint or unix-domain path without choosing whether
// it will later listen or connect. Node 24 exposes precisely this native
// operation as BoundSocket, so the stand-in preserves the same handle and
// single-owner transfer semantics as the compiled binding.
globalThis.nts_net_bind = (host, port, path, pipe, ipv6Only, reusePort) => {
  try {
    const bound = pipe
      ? new net.BoundSocket({ path })
      : new net.BoundSocket({ host, port, ipv6Only, reusePort });
    const handle = nextHandle++;
    boundSockets.set(handle, bound);
    return handle;
  } catch (error) {
    return codeOf(error);
  }
};

globalThis.nts_net_bound_address_text = (handle) => {
  const address = boundSockets.get(handle)?.address();
  return typeof address === "string" ? address : (address?.address ?? "");
};

globalThis.nts_net_bound_address_numbers = (handle) => {
  const address = boundSockets.get(handle)?.address();
  if (!address || typeof address === "string") return [];
  return [address.family === "IPv6" ? 6 : 4, address.port];
};

globalThis.nts_net_bound_fd = (handle) => boundSockets.get(handle)?.fd() ?? -9;

globalThis.nts_net_bound_close = (handle) => {
  const bound = boundSockets.get(handle);
  if (!bound) return -9;
  boundSockets.delete(handle);
  try {
    bound.close();
    return 0;
  } catch (error) {
    return codeOf(error);
  }
};

globalThis.nts_net_connect_bound = (handle, host, port, path, cb) => {
  const bound = boundSockets.get(handle);
  if (!bound) return -9;
  boundSockets.delete(handle);
  try {
    const socket = new net.Socket({ handle: bound });
    adoptAt(handle, socket);
    watchConnect(socket, cb);
    if (path) socket.connect({ path });
    else socket.connect({ host, port });
    return 0;
  } catch (error) {
    sockets.delete(handle);
    return codeOf(error);
  }
};

globalThis.nts_net_lookup = (host, family, cb) => {
  lookup(host, { family: family === 4 || family === 6 ? family : 0 }, (error, address, resolvedFamily) => {
    if (error) cb(codeOf(error), "", 0);
    else cb(0, address, resolvedFamily);
  });
};

globalThis.nts_net_read_start = (handle, onData, onEnd, onError) => {
  const entry = sockets.get(handle);
  if (!entry) return;
  if (!entry.reading) {
    entry.reading = true;
    entry.socket.on("data", (chunk) => onData(Array.from(chunk)));
    entry.socket.on("end", () => onEnd());
    entry.socket.on("error", (e) => onError(codeOf(e)));
  }
  entry.socket.resume();
};

globalThis.nts_net_read_stop = (handle) => {
  sockets.get(handle)?.socket.pause();
};

globalThis.nts_net_write = (handle, bytes, cb) => {
  const entry = sockets.get(handle);
  if (!entry) {
    cb(-9); // EBADF
    return -9;
  }
  const queued = !entry.socket.write(
    Buffer.from(bytes),
    (error) => cb(error ? codeOf(error) : 0),
  );
  return queued ? 1 : 0;
};

globalThis.nts_net_shutdown = (handle, cb) => {
  const entry = sockets.get(handle);
  if (!entry) {
    cb(-9);
    return;
  }
  entry.socket.end(() => cb(0));
};

globalThis.nts_net_close = (handle, callback) => {
  const entry = sockets.get(handle);
  if (entry) {
    sockets.delete(handle);
    if (entry.closed) {
      callback();
      return;
    }
    entry.closeCallback = callback;
    if (!entry.socket.destroyed) entry.socket.destroy();
  } else {
    callback();
  }
};

globalThis.nts_net_reset = (handle, callback) => {
  const entry = sockets.get(handle);
  if (!entry) {
    callback(-9);
    return;
  }
  sockets.delete(handle);
  if (entry.closed) {
    callback(0);
    return;
  }
  entry.closeCallback = () => callback(0);
  try {
    entry.socket.resetAndDestroy();
  } catch (error) {
    entry.closeCallback = null;
    callback(codeOf(error));
  }
};

function socketAddress(handle, remote) {
  const entry = sockets.get(handle);
  if (!entry) return undefined;
  return remote
    ? { address: entry.socket.remoteAddress, family: entry.socket.remoteFamily, port: entry.socket.remotePort }
    : entry.socket.address();
}

globalThis.nts_net_address_text = (handle, remote) => {
  const address = socketAddress(handle, remote);
  return address?.address ?? "";
};

globalThis.nts_net_address_numbers = (handle, remote) => {
  const address = socketAddress(handle, remote);
  if (!address || address.address === undefined) return [];
  return [address.family === "IPv6" ? 6 : 4, address.port];
};

globalThis.nts_net_set_no_delay = (handle, enable) => {
  sockets.get(handle)?.socket.setNoDelay(enable);
};
globalThis.nts_net_set_keepalive = (handle, enable, delay) => {
  sockets.get(handle)?.socket.setKeepAlive(enable, delay * 1000);
};
globalThis.nts_net_set_tos = (handle, value) => {
  try {
    const socket = sockets.get(handle)?.socket;
    if (!socket) return -9;
    socket.setTypeOfService(value);
    return 0;
  } catch (error) {
    return codeOf(error);
  }
};
globalThis.nts_net_get_tos = (handle) => {
  try {
    const socket = sockets.get(handle)?.socket;
    return socket ? socket.getTypeOfService() : -9;
  } catch (error) {
    return codeOf(error);
  }
};

globalThis.nts_net_listen = (
  host,
  port,
  path,
  backlog,
  ipv6Only,
  reusePort,
  readableAll,
  writableAll,
  fd,
  boundHandle,
  onListening,
  onConnection,
  onError,
) => {
  try {
    const bound = boundHandle >= 0 ? boundSockets.get(boundHandle) : undefined;
    if (boundHandle >= 0 && !bound) return -9;
    // Accepted transports follow the same rule as outgoing ones: the public
    // Socket above this seam, not the stand-in host socket, decides whether a
    // received FIN also ends writing.
    const server = net.createServer({ allowHalfOpen: true });
    server.on("connection", (socket) => onConnection(adopt(socket)));
    server.on("error", (e) => onError(codeOf(e)));
    server.on("listening", () => onListening());
    if (bound) {
      boundSockets.delete(boundHandle);
      server.listen(bound);
    } else if (fd >= 0) server.listen({ fd });
    else if (path && (readableAll || writableAll)) {
      server.listen({ path, backlog, readableAll, writableAll });
    } else if (path) server.listen(path, backlog);
    // Omitting Node's default wildcard host is observable here: public
    // `Server.listen(port)` binds synchronously, while supplying the literal
    // `"::"` takes the DNS-shaped asynchronous path. The real libuv binding
    // is synchronous, and callers may inspect an ephemeral port immediately
    // after `listen()` returns.
    else if (ipv6Only || reusePort) {
      server.listen({ port, host, backlog, ipv6Only, reusePort });
    } else if (host === "::") server.listen(port, backlog);
    else server.listen(port, host, backlog);
    const handle = bound ? boundHandle : nextHandle++;
    servers.set(handle, server);
    return handle;
  } catch (e) {
    return codeOf(e);
  }
};

function serverAddress(handle) {
  const server = servers.get(handle);
  return server?.address() ?? undefined;
}

globalThis.nts_net_server_address_text = (handle) => {
  const address = serverAddress(handle);
  if (typeof address === "string") return address;
  return address?.address ?? "";
};

globalThis.nts_net_server_address_numbers = (handle) => {
  const address = serverAddress(handle);
  if (!address || typeof address === "string") return [];
  return [address.family === "IPv6" ? 6 : 4, address.port];
};

globalThis.nts_net_server_close = (handle, cb) => {
  const server = servers.get(handle);
  if (!server) {
    cb();
    return;
  }
  servers.delete(handle);
  server.close(() => cb());
};

// Whether a handle keeps the process alive. Node's own `ref`/`unref`, which
// map to libuv's -- an unrefed handle still works, it just no longer counts as
// a reason for the loop to keep running.
globalThis.nts_net_ref = (handle, keepProcessAlive) => {
  const entry = sockets.get(handle);
  if (!entry) return;
  if (keepProcessAlive) entry.socket.ref();
  else entry.socket.unref();
};

globalThis.nts_net_server_ref = (handle, keepProcessAlive) => {
  const server = servers.get(handle);
  if (!server) return;
  if (keepProcessAlive) server.ref();
  else server.unref();
};
