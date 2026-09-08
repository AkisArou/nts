"use strict";

// `os.constants` in full, plus the shape of every object `os` returns.
//
// Node reads these tables from its C++ once and freezes them, so upstream
// `signals.SIGKILL` and `errno.ENOENT` are two rows of one generated table and a
// test of either is a test of the mechanism. Here they are assembled in
// TypeScript from three parallel native columns -- names, group names and values
// -- and a single mis-indexed row would put a signal number in `errno` with
// nothing to notice.
//
// So the whole table is enumerated: 33 signals, 79 errno values, 6 priorities
// and 5 dlopen flags, by name and by value, plus the sorted key set of
// `os.constants` itself. 135 rows, every value read off node v24.20.0.
//
// The object shapes are here for the same reason: `cpus()[0]`, its `times`, a
// `networkInterfaces()` entry and `userInfo()` each have a fixed key set that
// nothing upstream enumerates, because upstream they are built by one C++
// function per call.
//
// **One row is deliberately absent and is a live divergence, not a decision.**
// `os.userInfo({ encoding: "buffer" })` answers values that fail
// `Buffer.isBuffer` -- while `fs.readFileSync` in the *same process* answers
// values that pass. Their `.constructor` objects differ: there are two `Buffer`
// classes at run time and `os` has the other one. The cause is not yet known,
// so it is recorded in `docs/conformance/nodejs.md` and asserted nowhere: it is
// not a §13 decision, and pinning it would fix a defect in place.

const assert = require("node:assert");
const os = require("node:os");

const EXPECTED = [
  ["signals.count", "33"],
  ["signals.SIGABRT", "6"],
  ["signals.SIGALRM", "14"],
  ["signals.SIGBUS", "7"],
  ["signals.SIGCHLD", "17"],
  ["signals.SIGCONT", "18"],
  ["signals.SIGFPE", "8"],
  ["signals.SIGHUP", "1"],
  ["signals.SIGILL", "4"],
  ["signals.SIGINT", "2"],
  ["signals.SIGIO", "29"],
  ["signals.SIGIOT", "6"],
  ["signals.SIGKILL", "9"],
  ["signals.SIGPIPE", "13"],
  ["signals.SIGPOLL", "29"],
  ["signals.SIGPROF", "27"],
  ["signals.SIGPWR", "30"],
  ["signals.SIGQUIT", "3"],
  ["signals.SIGSEGV", "11"],
  ["signals.SIGSTKFLT", "16"],
  ["signals.SIGSTOP", "19"],
  ["signals.SIGSYS", "31"],
  ["signals.SIGTERM", "15"],
  ["signals.SIGTRAP", "5"],
  ["signals.SIGTSTP", "20"],
  ["signals.SIGTTIN", "21"],
  ["signals.SIGTTOU", "22"],
  ["signals.SIGURG", "23"],
  ["signals.SIGUSR1", "10"],
  ["signals.SIGUSR2", "12"],
  ["signals.SIGVTALRM", "26"],
  ["signals.SIGWINCH", "28"],
  ["signals.SIGXCPU", "24"],
  ["signals.SIGXFSZ", "25"],
  ["errno.count", "79"],
  ["errno.E2BIG", "7"],
  ["errno.EACCES", "13"],
  ["errno.EADDRINUSE", "98"],
  ["errno.EADDRNOTAVAIL", "99"],
  ["errno.EAFNOSUPPORT", "97"],
  ["errno.EAGAIN", "11"],
  ["errno.EALREADY", "114"],
  ["errno.EBADF", "9"],
  ["errno.EBADMSG", "74"],
  ["errno.EBUSY", "16"],
  ["errno.ECANCELED", "125"],
  ["errno.ECHILD", "10"],
  ["errno.ECONNABORTED", "103"],
  ["errno.ECONNREFUSED", "111"],
  ["errno.ECONNRESET", "104"],
  ["errno.EDEADLK", "35"],
  ["errno.EDESTADDRREQ", "89"],
  ["errno.EDOM", "33"],
  ["errno.EDQUOT", "122"],
  ["errno.EEXIST", "17"],
  ["errno.EFAULT", "14"],
  ["errno.EFBIG", "27"],
  ["errno.EHOSTUNREACH", "113"],
  ["errno.EIDRM", "43"],
  ["errno.EILSEQ", "84"],
  ["errno.EINPROGRESS", "115"],
  ["errno.EINTR", "4"],
  ["errno.EINVAL", "22"],
  ["errno.EIO", "5"],
  ["errno.EISCONN", "106"],
  ["errno.EISDIR", "21"],
  ["errno.ELOOP", "40"],
  ["errno.EMFILE", "24"],
  ["errno.EMLINK", "31"],
  ["errno.EMSGSIZE", "90"],
  ["errno.EMULTIHOP", "72"],
  ["errno.ENAMETOOLONG", "36"],
  ["errno.ENETDOWN", "100"],
  ["errno.ENETRESET", "102"],
  ["errno.ENETUNREACH", "101"],
  ["errno.ENFILE", "23"],
  ["errno.ENOBUFS", "105"],
  ["errno.ENODATA", "61"],
  ["errno.ENODEV", "19"],
  ["errno.ENOENT", "2"],
  ["errno.ENOEXEC", "8"],
  ["errno.ENOLCK", "37"],
  ["errno.ENOLINK", "67"],
  ["errno.ENOMEM", "12"],
  ["errno.ENOMSG", "42"],
  ["errno.ENOPROTOOPT", "92"],
  ["errno.ENOSPC", "28"],
  ["errno.ENOSR", "63"],
  ["errno.ENOSTR", "60"],
  ["errno.ENOSYS", "38"],
  ["errno.ENOTCONN", "107"],
  ["errno.ENOTDIR", "20"],
  ["errno.ENOTEMPTY", "39"],
  ["errno.ENOTSOCK", "88"],
  ["errno.ENOTSUP", "95"],
  ["errno.ENOTTY", "25"],
  ["errno.ENXIO", "6"],
  ["errno.EOPNOTSUPP", "95"],
  ["errno.EOVERFLOW", "75"],
  ["errno.EPERM", "1"],
  ["errno.EPIPE", "32"],
  ["errno.EPROTO", "71"],
  ["errno.EPROTONOSUPPORT", "93"],
  ["errno.EPROTOTYPE", "91"],
  ["errno.ERANGE", "34"],
  ["errno.EROFS", "30"],
  ["errno.ESPIPE", "29"],
  ["errno.ESRCH", "3"],
  ["errno.ESTALE", "116"],
  ["errno.ETIME", "62"],
  ["errno.ETIMEDOUT", "110"],
  ["errno.ETXTBSY", "26"],
  ["errno.EWOULDBLOCK", "11"],
  ["errno.EXDEV", "18"],
  ["priority.count", "6"],
  ["priority.PRIORITY_ABOVE_NORMAL", "-7"],
  ["priority.PRIORITY_BELOW_NORMAL", "10"],
  ["priority.PRIORITY_HIGH", "-14"],
  ["priority.PRIORITY_HIGHEST", "-20"],
  ["priority.PRIORITY_LOW", "19"],
  ["priority.PRIORITY_NORMAL", "0"],
  ["dlopen.count", "5"],
  ["dlopen.RTLD_DEEPBIND", "8"],
  ["dlopen.RTLD_GLOBAL", "256"],
  ["dlopen.RTLD_LAZY", "1"],
  ["dlopen.RTLD_LOCAL", "0"],
  ["dlopen.RTLD_NOW", "2"],
  ["top-level-keys", "UV_UDP_REUSEADDR,dlopen,errno,priority,signals"],
  ["EOL", "\"\\n\""],
  ["devNull", "\"/dev/null\""],
  ["endianness", "LE"],
  ["userInfo-keys", "gid,homedir,shell,uid,username"],
  ["cpus-entry-keys", "model,speed,times"],
  ["cpus-times-keys", "idle,irq,nice,sys,user"],
  ["netif-entry-keys", "address,cidr,family,internal,mac,netmask"],
  ["loadavg-length", "3"],
];

const rows = [];
const group = (name, obj) => {
  const keys = Object.keys(obj).sort();
  rows.push([name + ".count", String(keys.length)]);
  for (const k of keys) rows.push([name + "." + k, String(obj[k])]);
};

group("signals", os.constants.signals);
group("errno", os.constants.errno);
group("priority", os.constants.priority);
group("dlopen", os.constants.dlopen);
rows.push(["top-level-keys", Object.keys(os.constants).sort().join(",")]);
rows.push(["EOL", JSON.stringify(os.EOL)]);
rows.push(["devNull", JSON.stringify(os.devNull)]);
rows.push(["endianness", os.endianness()]);
rows.push(["userInfo-keys", Object.keys(os.userInfo()).sort().join(",")]);
rows.push(["cpus-entry-keys", Object.keys(os.cpus()[0]).sort().join(",")]);
rows.push(["cpus-times-keys", Object.keys(os.cpus()[0].times).sort().join(",")]);
rows.push(["netif-entry-keys", (() => { const n = os.networkInterfaces();
  const first = Object.values(n)[0][0]; return Object.keys(first).sort().join(","); })()]);
rows.push(["loadavg-length", String(os.loadavg().length)]);

assert.strictEqual(rows.length, EXPECTED.length, "every case was reached");
for (let i = 0; i < EXPECTED.length; i++) {
  assert.strictEqual(rows[i][0], EXPECTED[i][0], `case ${i} label`);
  assert.strictEqual(rows[i][1], EXPECTED[i][1], rows[i][0]);
}
