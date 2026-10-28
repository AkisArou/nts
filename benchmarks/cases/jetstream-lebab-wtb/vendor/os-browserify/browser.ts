// Exact module body from JetStream 3.0 ./node_modules/os-browserify/browser.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../webpack.ts";

interface BrowserOS {
 endianness(): string;
 hostname(): string;
 loadavg(): number[];
 uptime(): number;
 freemem(): number;
 totalmem(): number;
 cpus(): unknown[];
 type(): string;
 release(): string | undefined;
 networkInterfaces(): Record<string, unknown>;
 getNetworkInterfaces(): Record<string, unknown>;
 arch(): string;
 platform(): string;
 tmpdir(): string;
 tmpDir(): string;
 EOL: string;
 homedir(): string;
}

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for os-browserify/browser.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return isRecord(value) && typeof value.EOL === "string" && ["endianness", "hostname", "loadavg", "uptime", "freemem", "totalmem", "cpus", "type", "release", "networkInterfaces", "getNetworkInterfaces", "arch", "platform", "tmpdir", "tmpDir", "homedir"].every(key => typeof value[key] === "function");
}
function initialize(): BrowserOS {
const exports: Partial<BrowserOS> = {};
let module = {exports};
cache = module;


exports.endianness = function () { return 'LE' };

exports.hostname = function () {
    if (typeof location !== 'undefined') {
        return location.hostname
    }
    else return '';
};

exports.loadavg = function () { return [] };

exports.uptime = function () { return 0 };

exports.freemem = function () {
    return Number.MAX_VALUE;
};

exports.totalmem = function () {
    return Number.MAX_VALUE;
};

exports.cpus = function () { return [] };

exports.type = function () { return 'Browser' };

exports.release = function () {
    if (typeof navigator !== 'undefined') {
        return navigator.appVersion;
    }
    return '';
};

exports.networkInterfaces
= exports.getNetworkInterfaces
= function () { return {} };

exports.arch = function () { return 'javascript' };

exports.platform = function () { return 'browser' };

exports.tmpdir = exports.tmpDir = function () {
    return '/tmp';
};

exports.EOL = '\n';

exports.homedir = function () {
	return '/'
};


/***/ 
if (!isExport(exports)) throw new TypeError("Unexpected completed browser OS exports");
return exports;
}
