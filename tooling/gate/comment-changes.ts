// Narrowing is optional. Lexer errors, unsupported syntax and missing tools
// retain the ordinary path-based gate. Never run a preprocessor: #if 0 is code.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";

const LIMIT = 4 * 1024 * 1024;
const options = { encoding: "utf8" as const, timeout: 15000, maxBuffer: LIMIT * 12 };
let rustLibrary: string | null | undefined;
function rustLexer(): string | null {
  if (rustLibrary !== undefined) return rustLibrary;
  rustLibrary = null;
  const source = new URL("./comment-tokens.rs", import.meta.url);
  const version = spawnSync("rustc", ["-vV"], options);
  if (version.status !== 0) return null;
  const key = createHash("sha256").update(readFileSync(source)).update(version.stdout).digest("hex");
  const root = join(homedir(), ".cache/nts-tools/comment-lexer", key);
  const library = join(root, "libnts_comment_tokens.so");
  if (!existsSync(library)) {
    mkdirSync(root, { recursive: true });
    const temporary = mkdtempSync(join(root, "build-"));
    try {
      const output = join(temporary, "lexer.so");
      const build = spawnSync("rustc", ["--crate-type=proc-macro", "--crate-name=nts_comment_tokens", "--edition=2024", source.pathname, "-o", output], options);
      if (build.status !== 0) return null;
      renameSync(output, library);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  }
  return rustLibrary = library;
}

function rust(text: string): string | null {
  // A proc macro can inspect raw source/comments, and location macros observe
  // comment line changes. Such files keep the ordinary gate. The compiler's
  // builtin attributes do not inspect comment prose; derives may be custom.
  if (/\b(line|column|file|stringify|include_str|include_bytes)\s*!/.test(text)) return null;
  // Names alone cannot prove that a macro is the standard builtin: a crate
  // can shadow it. Doc attributes passed into a macro can be runtime data.
  if (/\b[A-Za-z_]\w*\s*!\s*[({\[]|\bmacro_rules\s*!/.test(text)) return null;
  if (/#\s*!?\s*\[\s*(?!doc\b|derive\b|cfg\b|cfg_attr\b|allow\b|warn\b|deny\b|forbid\b|expect\b|test\b|ignore\b|inline\b|cold\b|repr\b|path\b|must_use\b|deprecated\b|non_exhaustive\b|no_mangle\b|export_name\b|link\b|track_caller\b)[A-Za-z_]/.test(text)) return null;
  // cfg_attr may introduce an arbitrary procedural attribute.
  if (/\bcfg_attr\s*\(/.test(text)) return null;
  if (/#\s*\[\s*derive\b/.test(text)) return null;
  const library = rustLexer();
  if (!library) return null;
  const input = `extern crate nts_comment_tokens;\nnts_comment_tokens::comment_signature! {\n${text}\n}\n`;
  const result = spawnSync("rustc", ["--crate-name=nts_comment_input", "--crate-type=lib", "--edition=2024", "--error-format=json", "--emit=metadata", "--extern", `nts_comment_tokens=${library}`, "-o", "/dev/null", "-"], { ...options, input });
  let signature: string | null = null;
  for (const line of (result.stderr ?? "").split("\n").filter(Boolean)) {
    let record;
    try { record = JSON.parse(line); } catch { return null; }
    if (record.level !== "error") continue;
    if (record.message.startsWith("nts-comment-tokens-v1:")) signature = record.message.slice("nts-comment-tokens-v1:".length);
    else if (!record.message.startsWith("aborting due to")) return null;
  }
  return result.status === 1 && signature !== "unknown" ? signature : null;
}

type Range = { start: number; end: number };
function significantComment(text: string): boolean {
  const body = text.replace(/^\/\/[!/]*|^\/\*+|\*\/$/g, "");
  return text.startsWith("/*---") || body.split(/\r?\n/).some(line => /^\s*(?:\*\s*)?[A-Za-z][\w-]*:\s/.test(line));
}
function withoutComments(text: string, ranges: Range[]): string {
  let output = "", cursor = 0;
  for (const { start, end } of ranges) {
    output += text.slice(cursor, start);
    // A comment separates tokens and can contain an ASI/preprocessor newline.
    output += " " + text.slice(start, end).replace(/[^\r\n\u2028\u2029]/g, "");
    cursor = end;
  }
  return output + text.slice(cursor);
}

function typescript(text: string): string | null {
  // A new/unprepared worktree may lack this tool. That is unknown, never a
  // reason to omit the ordinary gate, and must not break owed for other files.
  const { createScanner, LanguageVariant, SyntaxKind } = createRequire(import.meta.url)("typescript/unstable/ast");
  const scanner = createScanner(false, LanguageVariant.Standard, text);
  const ranges: Range[] = [];
  let end = 0;
  for (let count = 0; count <= text.length + 1; count++) {
    const kind = scanner.scan();
    if (kind === SyntaxKind.EndOfFile) return withoutComments(text, ranges);
    const start = scanner.getTokenStart(), next = scanner.getTokenEnd();
    if (next <= end || scanner.isUnterminated() || kind === SyntaxKind.Unknown) return null;
    end = next;
    // Regex/division and interpolated templates need parser context. JSX is
    // excluded by the caller. Leave these files to the ordinary rules.
    if ([SyntaxKind.SlashToken, SyntaxKind.SlashEqualsToken, SyntaxKind.TemplateHead, SyntaxKind.TemplateMiddle, SyntaxKind.TemplateTail].includes(kind)) return null;
    if (kind === SyntaxKind.SingleLineCommentTrivia || kind === SyntaxKind.MultiLineCommentTrivia) {
      const comment = text.slice(start, next);
      // Compiler directives, JSDoc types and fixture expectations are inputs.
      if (significantComment(comment) || /@|#__|<reference|<amd-|\bexpect(?:-ir)?\s*:|sourceMappingURL|sourceURL/.test(comment)) return null;
      ranges.push({ start, end: next });
    }
  }
  return null;
}

function c(text: string): string | null {
  // Translation-phase rewrites would make raw offsets ambiguous. __LINE__
  // and #line observe changes to comment layout.
  if (/\\\r?\n|\?\?|\b__LINE__\b|^\s*#\s*line\b/m.test(text)) return null;
  const result = spawnSync("clang", ["-Xclang", "-dump-raw-tokens", "-fsyntax-only", "-x", "c", "-"], { ...options, input: text });
  if (result.status !== 0) return null;
  const rows = [...result.stderr.matchAll(/^(\w+)[^\n]*\bLoc=<<stdin>:(\d+):(\d+)>[^\n]*$/gm)];
  if (rows.length !== result.stderr.split("\n").filter(Boolean).length || !rows.length) return null;
  const bytes = Buffer.from(text), lines = [0];
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 10) lines.push(i + 1);
  const starts = rows.map(r => (lines[Number(r[2]) - 1] ?? -LIMIT) + Number(r[3]) - 1);
  if (starts[0] !== 0 || starts.some((s, i) => s < 0 || s >= bytes.length || (i && s <= starts[i - 1]))) return null;
  const ranges: Range[] = [];
  for (const [i, row] of rows.entries()) {
    const start = starts[i], end = starts[i + 1] ?? bytes.length;
    const raw = bytes.subarray(start, end).toString();
    if (row[1] === "unknown" && !/^\s+$/.test(raw)) return null;
    if (row[1] === "comment") {
      // Include lexer diagnostics and offsets in the trust boundary.
      if (!raw.startsWith("//") && !(raw.startsWith("/*") && raw.endsWith("*/"))) return null;
      if (significantComment(raw)) return null;
      ranges.push({ start: bytes.subarray(0, start).toString().length, end: bytes.subarray(0, end).toString().length });
    }
  }
  return withoutComments(text, ranges);
}

function changedLines(before: string, after: string): string[] | null {
  const parent = join(homedir(), ".cache/nts-tools");
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, "comment-diff-"));
  try {
    const old = join(directory, "before"), updated = join(directory, "after");
    writeFileSync(old, before); writeFileSync(updated, after);
    const diff = spawnSync("git", ["diff", "--no-index", "--no-ext-diff", "--no-textconv", "--no-color", "--unified=0", "--", old, updated], options);
    if (diff.status !== 1) return null;
    return diff.stdout.split("\n").filter(line => /^[+-]/.test(line) && !/^--- |^\+\+\+ /.test(line)).map(line => line.slice(1));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

/** false includes unknown; it always retains the existing path obligation. */
export function commentsOnly(path: string, before: string, after: string): boolean {
  if (before === after || before.includes("\ufffd") || after.includes("\ufffd") || Buffer.byteLength(before) > LIMIT || Buffer.byteLength(after) > LIMIT) return false;
  const lex = path.endsWith(".rs") ? rust : path.endsWith(".ts") ? typescript : /\.(c|h)$/.test(path) ? c : null;
  if (!lex) return false;
  try {
    const a = lex(before), b = lex(after);
    if (a === null || b === null || a !== b) return false;
    if (path.endsWith(".rs")) {
      if (before.includes("/*---") || after.includes("/*---")) return false;
      const changed = changedLines(before, after);
      // Only changed lines can be newly significant; unchanged Rust fields
      // such as name: String must not turn a prose edit into a compiler gate.
      if (!changed || changed.some(line => /\/\/[!/]?\s*[A-Za-z][\w-]*:\s|\/\*+\s*[A-Za-z][\w-]*:\s|^\s*(?:\*\s*)?[A-Za-z][\w-]*:\s/.test(line))) return false;
    }
    return true;
  } catch { return false; }
}
