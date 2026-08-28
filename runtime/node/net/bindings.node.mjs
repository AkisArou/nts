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
import { Buffer } from "node:buffer";

let nextHandle = 1;
const sockets = new Map();
const servers = new Map();

const codeOf = (e) => (typeof e?.errno === "number" ? (e.errno > 0 ? -e.errno : e.errno) : -1);

/** Register a connected socket and hand back its handle. */
function adopt(socket) {
  const handle = nextHandle++;
  // Paused until the module asks: nothing should arrive before `read_start`,
  // or the first chunks are lost before anyone is listening.
  socket.pause();
  sockets.set(handle, { socket, reading: false });
  return handle;
}

globalThis.nts_net_connect = (host, port, path, cb) => {
  try {
    const socket = path ? net.connect({ path }) : net.connect({ host, port });
    const handle = adopt(socket);
    socket.once("connect", () => cb(0));
    socket.once("error", (e) => cb(codeOf(e)));
    return handle;
  } catch (e) {
    return codeOf(e);
  }
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
    return;
  }
  entry.socket.write(Buffer.from(bytes), (error) => cb(error ? codeOf(error) : 0));
};

globalThis.nts_net_shutdown = (handle, cb) => {
  const entry = sockets.get(handle);
  if (!entry) {
    cb(-9);
    return;
  }
  entry.socket.end(() => cb(0));
};

globalThis.nts_net_close = (handle) => {
  const entry = sockets.get(handle);
  if (entry) {
    entry.socket.destroy();
    sockets.delete(handle);
  }
};

globalThis.nts_net_address = (handle, remote) => {
  const entry = sockets.get(handle);
  if (!entry) return [];
  const a = remote
    ? { address: entry.socket.remoteAddress, family: entry.socket.remoteFamily, port: entry.socket.remotePort }
    : entry.socket.address();
  if (!a || a.address === undefined) return [];
  return [a.address, a.family === "IPv6" ? 6 : 4, a.port];
};

globalThis.nts_net_set_no_delay = (handle, enable) => {
  sockets.get(handle)?.socket.setNoDelay(enable);
};
globalThis.nts_net_set_keepalive = (handle, enable, delay) => {
  sockets.get(handle)?.socket.setKeepAlive(enable, delay * 1000);
};

globalThis.nts_net_listen = (host, port, path, backlog, onListening, onConnection, onError) => {
  try {
    const server = net.createServer();
    server.on("connection", (socket) => onConnection(adopt(socket)));
    server.on("error", (e) => onError(codeOf(e)));
    server.on("listening", () => onListening());
    if (path) server.listen(path, backlog);
    else server.listen(port, host, backlog);
    const handle = nextHandle++;
    servers.set(handle, server);
    return handle;
  } catch (e) {
    return codeOf(e);
  }
};

globalThis.nts_net_server_address = (handle) => {
  const server = servers.get(handle);
  const a = server?.address();
  if (!a) return [];
  // A unix socket's address is its path: one column rather than three.
  if (typeof a === "string") return [a];
  return [a.address, a.family === "IPv6" ? 6 : 4, a.port];
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
