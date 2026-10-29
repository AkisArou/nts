import type {Options} from "../../types/recast/lib/options.js";
// Exact module body from JetStream 3.0 ./node_modules/recast/main.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, readProperty, runtimeArrayLike} from "../../webpack.ts";
import {load as load0} from "../process/browser.ts";
import {load as load1} from "../tslib/tslib.es6.ts";
import {load as load2} from "../_5042.ts";
import {load as load3} from "../ast-types/lib/main.ts";
import {load as load4} from "./lib/parser.ts";
import {load as load5} from "./lib/printer.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for recast/main.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return exportsReady(value, ["__esModule","types","print","prettyPrint","run","parse","visit"]);
}
function initialize() {
interface Transformer {
  (ast: unknown, callback: (ast: unknown) => void): void;
}
interface RunOptions extends Options {
  writeback?(code: string): void;
}

const exports: { __esModule?: true; "types"?: typeof types; "print"?: typeof print; "prettyPrint"?: typeof prettyPrint; "run"?: typeof run; "parse"?: NonNullable<ReturnType<typeof load4>["parse"]>; "visit"?: NonNullable<ReturnType<typeof load3>["visit"]>; } = {};
let module = {exports};
cache = module;


"use strict";
/* provided dependency */ var process = load0();

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.run = exports.prettyPrint = exports.print = exports.visit = exports.types = exports.parse = void 0;
var tslib_1 = load1();
var fs_1 = tslib_1.__importDefault(load2());
var types = tslib_1.__importStar(load3());
exports.types = types;
var parser_1 = load4();
Object.defineProperty(exports, "parse", ({ enumerable: true, get: function () { return parser_1.parse; } }));
var printer_1 = load5();
/**
 * Traverse and potentially modify an abstract syntax tree using a
 * convenient visitor syntax:
 *
 *   recast.visit(ast, {
 *     names: [],
 *     visitIdentifier: function(path) {
 *       var node = path.value;
 *       this.visitor.names.push(node.name);
 *       this.traverse(path);
 *     }
 *   });
 */
var ast_types_1 = load3();
Object.defineProperty(exports, "visit", ({ enumerable: true, get: function () { return ast_types_1.visit; } }));
/**
 * Reprint a modified syntax tree using as much of the original source
 * code as possible.
 */
function print(node: unknown, options?: Options) {
    return new printer_1.Printer(options).print(node);
}
exports.print = print;
/**
 * Print without attempting to reuse any original source code.
 */
function prettyPrint(node: unknown, options?: Options) {
    return new printer_1.Printer(options).printGenerically(node);
}
exports.prettyPrint = prettyPrint;
/**
 * Convenient command-line interface (see e.g. example/add-braces).
 */
function run(transformer: Transformer, options?: RunOptions) {
    return runFile(runtimeArrayLike(readProperty(process, "argv"))[2], transformer, options);
}
exports.run = run;
function runFile(path: unknown, transformer: Transformer, options?: RunOptions) {
    recastFileSystem(readProperty(fs_1, "default")).readFile!(path, "utf-8", function (err: unknown, code: string) {
        if (err) {
            console.error(err);
            return;
        }
        runString(code, transformer, options);
    });
}
function defaultWriteback(output: string) {
    recastOutput(readProperty(process, "stdout")).write(output);
}
interface RecastFileSystem {
    readFile?: (path: unknown, encoding: string, callback: (error: unknown, code: string) => void) => void;
}
function recastFileSystem(value: unknown): RecastFileSystem {
    if (isRecastFileSystem(value)) return value;
    throw new TypeError("Expected original file-system module");
}
function isRecastFileSystem(value: unknown): value is RecastFileSystem {
    return isRecord(value) && (value.readFile === undefined || typeof value.readFile === "function");
}
interface RecastOutput { write(text: string): unknown; }
function recastOutput(value: unknown): RecastOutput {
    if (isRecastOutput(value)) return value;
    throw new TypeError("Expected original output stream");
}
function isRecastOutput(value: unknown): value is RecastOutput {
    return isRecord(value) && typeof value.write === "function";
}
function runString(code: string, transformer: Transformer, options?: RunOptions) {
    var writeback = (options && options.writeback) || defaultWriteback;
    transformer((0, parser_1.parse)(code, options), function (node) {
        writeback(print(node, options).code);
    });
}


/***/ 
if (!exportsReady(exports, ["__esModule","types","print","prettyPrint","run","parse","visit"])) throw new TypeError("Incomplete original module exports");
return exports;
}
