// The native half of `node:dgram`, for the node-side run only.
//
// One UDP socket per handle, numbered rather than passed by reference, because
// the compiled seam is a C integer and a JavaScript object cannot cross it.
// The same shape as `net`'s: a table here, an index on the other side.
//
// Node's own `dgram` underneath. That is the point of this file — it stands in
// for what the compiled runtime will do with libuv, so the module above can be
// tested as itself rather than as a plan.
import "../internal/bindings.node.mjs";
import dgram from "node:dgram";

/** Open handles, by the index the module holds. */
const sockets = new Map();
let nextHandle = 1;

const at = (handle) => sockets.get(handle);

/** libuv's convention: negative on failure, zero on success. */
const errnoOf = (fn) => {
  try {
    fn();
    return 0;
  } catch (error) {
    // `errno` is already libuv's negative number where node kept it; where it
    // did not, the code is all we have and -1 says "failed" without inventing
    // a specific reason.
    return typeof error?.errno === "number" ? error.errno : -1;
  }
};

globalThis.nts_udp_new = (type, reuseAddr, ipv6Only) => {
  const socket = dgram.createSocket({ type, reuseAddr, ipv6Only });
  // Node's socket binds itself on first send; ours drives that explicitly, so
  // the errors it would emit on its own would be duplicates of the ones the
  // module raises. Swallowed here rather than left to become uncaught.
  socket.on("error", () => {});
  const handle = nextHandle++;
  sockets.set(handle, { socket, refed: true });
  return handle;
};

globalThis.nts_udp_bind = (handle, address, port, onBound) => {
  const entry = at(handle);
  if (!entry) return -1;
  // Reported when node says `listening`, not when `bind` returns. The two are
  // not the same moment and `address()` is only answerable after the second.
  const onError = (error) => {
    entry.socket.removeListener("listening", onListening);
    onBound(typeof error?.errno === "number" ? error.errno : -1);
  };
  const onListening = () => {
    entry.socket.removeListener("error", onError);
    onBound(0);
  };
  entry.socket.once("listening", onListening);
  entry.socket.once("error", onError);
  const err = errnoOf(() => entry.socket.bind(port, address));
  if (err !== 0) {
    entry.socket.removeListener("listening", onListening);
    entry.socket.removeListener("error", onError);
  }
  return err;
};

globalThis.nts_udp_close = (handle) => {
  const entry = at(handle);
  if (!entry) return;
  sockets.delete(handle);
  try {
    entry.socket.close();
  } catch {
    // Closing a socket that never bound throws on node and is not a failure
    // the module can act on: the handle is gone either way.
  }
};

/** libuv's `EBADF`, which is what asking an unbound socket for its name is. */
const UV_EBADF = -9;

globalThis.nts_udp_address = (handle, remote) => {
  const entry = at(handle);
  if (!entry) return [UV_EBADF];
  try {
    const info = remote ? entry.socket.remoteAddress() : entry.socket.address();
    return [info.address, info.family, info.port];
  } catch (error) {
    // Node raises `ERR_SOCKET_DGRAM_NOT_RUNNING` or `ERR_SOCKET_DGRAM_NOT_CONNECTED`
    // here rather than an errno, and the compiled runtime will have the errno
    // libuv gave it. `EBADF` is what that is: a question about a socket that
    // is not open.
    return [typeof error?.errno === "number" ? error.errno : UV_EBADF];
  }
};

globalThis.nts_udp_send = (handle, bytes, port, address, callback) => {
  const entry = at(handle);
  if (!entry) return -1;
  const buffer = Buffer.from(bytes);
  const done = (error, sent) => {
    callback(error ? (typeof error.errno === "number" ? error.errno : -1) : 0, sent ?? buffer.length);
  };
  return errnoOf(() => {
    // Port zero is how the module says "connected, no destination" -- the two
    // call shapes node's `send` has, chosen by the same fact.
    if (port) entry.socket.send(buffer, port, address, done);
    else entry.socket.send(buffer, done);
  });
};

globalThis.nts_udp_recv_start = (handle, onMessage, onError) => {
  const entry = at(handle);
  if (!entry) return -1;
  entry.onMessage = (message, rinfo) => {
    onMessage(Array.from(message), rinfo.address, rinfo.family, rinfo.port);
  };
  entry.onError = (error) => onError(typeof error?.errno === "number" ? error.errno : -1);
  entry.socket.on("message", entry.onMessage);
  entry.socket.on("error", entry.onError);
  return 0;
};

globalThis.nts_udp_recv_stop = (handle) => {
  const entry = at(handle);
  if (!entry) return -1;
  if (entry.onMessage) entry.socket.removeListener("message", entry.onMessage);
  if (entry.onError) entry.socket.removeListener("error", entry.onError);
  entry.onMessage = undefined;
  entry.onError = undefined;
  return 0;
};

globalThis.nts_udp_connect = (handle, address, port, onConnected) => {
  const entry = at(handle);
  if (!entry) return -1;
  return errnoOf(() => entry.socket.connect(port, address, () => onConnected(0)));
};

globalThis.nts_udp_disconnect = (handle) => {
  const entry = at(handle);
  if (!entry) return -1;
  return errnoOf(() => entry.socket.disconnect());
};

globalThis.nts_udp_set_broadcast = (handle, on) =>
  errnoOf(() => at(handle).socket.setBroadcast(on));
globalThis.nts_udp_set_ttl = (handle, ttl) =>
  errnoOf(() => at(handle).socket.setTTL(ttl));
globalThis.nts_udp_set_multicast_ttl = (handle, ttl) =>
  errnoOf(() => at(handle).socket.setMulticastTTL(ttl));
globalThis.nts_udp_set_multicast_loopback = (handle, on) =>
  errnoOf(() => at(handle).socket.setMulticastLoopback(on));
globalThis.nts_udp_set_multicast_interface = (handle, address) =>
  errnoOf(() => at(handle).socket.setMulticastInterface(address));

globalThis.nts_udp_membership = (handle, address, iface, join) =>
  errnoOf(() => {
    const socket = at(handle).socket;
    // An empty interface means "the default one", which node spells as an
    // omitted argument rather than as an empty string.
    if (join) socket.addMembership(address, iface || undefined);
    else socket.dropMembership(address, iface || undefined);
  });

globalThis.nts_udp_buffer_size = (handle, size, receive) => {
  const entry = at(handle);
  if (!entry) return -1;
  try {
    // Size zero is the read: there is no such thing as a zero-byte socket
    // buffer, so the module uses it to mean "tell me what it is".
    if (size === 0) {
      return receive ? entry.socket.getRecvBufferSize() : entry.socket.getSendBufferSize();
    }
    if (receive) entry.socket.setRecvBufferSize(size);
    else entry.socket.setSendBufferSize(size);
    return 0;
  } catch (error) {
    return typeof error?.errno === "number" ? error.errno : -1;
  }
};

globalThis.nts_udp_ref = (handle, keepProcessAlive) => {
  const entry = at(handle);
  if (!entry) return;
  entry.refed = keepProcessAlive;
  if (keepProcessAlive) entry.socket.ref();
  else entry.socket.unref();
};
