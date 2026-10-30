// A hand-written generated-parser prototype: known fields go straight into
// typed objects. Token, string escape and number rules stay with Scanner.
import { Scanner, readMemberKey } from "../../../runtime/ecmascript/src/json/parse.ts";
import type { Document, Row } from "./source.ts";

const ROOT = 0, ROWS = 1, COUNT = 2, NOTE = 3, ID = 4, NAME = 5, OK = 6, SCORE = 7, TAGS = 8;
const OBJECT = 1, ARRAY = 2, NUMBER = 3, STRING = 4, BOOLEAN = 5, NULL = 6, MISSING = 7;
const EMPTY_TAGS: string[] = [];

function fieldName(field: number): string {
  if (field === ROWS) return "rows";
  if (field === COUNT) return "count";
  if (field === NOTE) return "note";
  if (field === ID) return "id";
  if (field === NAME) return "name";
  if (field === OK) return "ok";
  if (field === SCORE) return "score";
  return "tags";
}

class TypedReader extends Scanner {
  problem = 0;
  field = ROOT;
  row = -1;
  tag = -1;

  clear(): void { this.problem = 0; this.field = ROOT; this.row = -1; this.tag = -1; }

  key(): number {
    this.skipWhitespace();
    const at = this.at;
    let key = -1, width = 0;
    // The generated common path reads literal keys without allocating them.
    if (this.source.startsWith('"id"', at)) { key = ID; width = 4; }
    else if (this.source.startsWith('"name"', at)) { key = NAME; width = 6; }
    else if (this.source.startsWith('"ok"', at)) { key = OK; width = 4; }
    else if (this.source.startsWith('"score"', at)) { key = SCORE; width = 7; }
    else if (this.source.startsWith('"tags"', at)) { key = TAGS; width = 6; }
    else if (this.source.startsWith('"rows"', at)) { key = ROWS; width = 6; }
    else if (this.source.startsWith('"count"', at)) { key = COUNT; width = 7; }
    else if (this.source.startsWith('"note"', at)) { key = NOTE; width = 6; }
    if (width !== 0) {
      this.at += width;
      this.skipWhitespace();
      if (this.peek() !== 58) throw this.fail("Expected ':' after property name");
      this.at++;
      return key;
    }
    const name = readMemberKey(this);
    if (name === "rows") return ROWS;
    if (name === "count") return COUNT;
    if (name === "note") return NOTE;
    if (name === "id") return ID;
    if (name === "name") return NAME;
    if (name === "ok") return OK;
    if (name === "score") return SCORE;
    if (name === "tags") return TAGS;
    return -1;
  }

  // A syntax-only work stack for unobserved keys and mismatched values.
  // Input nesting can grow this stack; it cannot grow the host call stack.
  skipValue(): void {
    const kinds: number[] = [], states: number[] = [];
    let needValue = true;
    for (;;) {
      this.skipWhitespace();
      if (needValue) {
        const ch = this.peek();
        if (ch === 123 || ch === 91) {
          this.at++;
          kinds.push(ch);
          states.push(0);
        } else {
          if (ch === 34) this.readString();
          else if (ch === 116) this.expectWord("true");
          else if (ch === 102) this.expectWord("false");
          else if (ch === 110) this.expectWord("null");
          else if (ch === 45 || (ch >= 48 && ch <= 57)) this.readNumber();
          else throw this.fail("Expected a JSON value");
          if (kinds.length === 0) return;
        }
        needValue = false;
        continue;
      }
      if (kinds.length === 0) return;
      const top = kinds.length - 1, kind = kinds[top], state = states[top], ch = this.peek();
      const close = kind === 123 ? 125 : 93;
      if ((state === 0 || state === 1) && ch === close) {
        this.at++; kinds.pop(); states.pop();
        if (kinds.length === 0) return;
        continue;
      }
      if (state === 1) {
        if (ch !== 44) throw this.fail("Expected ',' or closing delimiter");
        this.at++; states[top] = 2;
        continue;
      }
      // State 2 follows a comma and cannot accept the closing delimiter.
      if (kind === 123) readMemberKey(this);
      states[top] = 1;
      needValue = true;
    }
  }

  number(): number {
    this.clear(); this.skipWhitespace();
    const ch = this.peek();
    if (ch === 45 || (ch >= 48 && ch <= 57)) return this.readNumber();
    this.skipValue(); this.problem = NUMBER; return 0;
  }
  text(): string {
    this.clear(); this.skipWhitespace();
    if (this.peek() === 34) return this.readString();
    this.skipValue(); this.problem = STRING; return "";
  }
  boolean(): boolean {
    this.clear(); this.skipWhitespace();
    if (this.peek() === 116) { this.expectWord("true"); return true; }
    if (this.peek() === 102) { this.expectWord("false"); return false; }
    this.skipValue(); this.problem = BOOLEAN; return false;
  }
  nullValue(): void {
    this.clear(); this.skipWhitespace();
    if (this.peek() === 110) { this.expectWord("null"); return; }
    this.skipValue(); this.problem = NULL;
  }
  separator(close: number): boolean {
    this.skipWhitespace();
    const ch = this.peek();
    if (ch === close) { this.at++; return true; }
    if (ch !== 44) throw this.fail("Expected ',' or closing delimiter");
    this.at++; return false;
  }

  tags(): string[] {
    this.clear(); this.skipWhitespace();
    if (this.peek() !== 91) { this.skipValue(); this.problem = ARRAY; return EMPTY_TAGS; }
    this.at++; this.skipWhitespace();
    const result: string[] = [];
    let bad = -1, index = 0;
    if (this.peek() === 93) { this.at++; return result; }
    for (;;) {
      const value = this.text();
      if (bad === -1 && this.problem !== 0) bad = index;
      result.push(value); index++;
      if (this.separator(93)) break;
    }
    this.clear();
    if (bad !== -1) { this.problem = STRING; this.tag = bad; }
    return result;
  }

  record(index: number): Row {
    this.clear(); this.skipWhitespace();
    let id = 0, name = "", ok = false, score = 0, tags = EMPTY_TAGS;
    if (this.peek() !== 123) {
      this.skipValue(); this.problem = OBJECT; this.field = ROWS; this.row = index;
      return { id, name, ok, score, tags };
    }
    this.at++; this.skipWhitespace();
    let seen = 0, idBad = 0, nameBad = 0, okBad = 0, scoreBad = 0, tagsBad = 0, tagBad = -1;
    if (this.peek() === 125) this.at++;
    else for (;;) {
      const key = this.key();
      if (key === ID) { id = this.number(); idBad = this.problem; seen |= 1; }
      else if (key === NAME) { name = this.text(); nameBad = this.problem; seen |= 2; }
      else if (key === OK) { ok = this.boolean(); okBad = this.problem; seen |= 4; }
      else if (key === SCORE) { score = this.number(); scoreBad = this.problem; seen |= 8; }
      else if (key === TAGS) { tags = this.tags(); tagsBad = this.problem; tagBad = this.tag; seen |= 16; }
      else this.skipValue();
      if (this.separator(125)) break;
    }
    this.clear(); this.row = index;
    if (!(seen & 1) || idBad) { this.problem = seen & 1 ? idBad : MISSING; this.field = ID; }
    else if (!(seen & 2) || nameBad) { this.problem = seen & 2 ? nameBad : MISSING; this.field = NAME; }
    else if (!(seen & 4) || okBad) { this.problem = seen & 4 ? okBad : MISSING; this.field = OK; }
    else if (!(seen & 8) || scoreBad) { this.problem = seen & 8 ? scoreBad : MISSING; this.field = SCORE; }
    else if (!(seen & 16) || tagsBad) { this.problem = seen & 16 ? tagsBad : MISSING; this.field = TAGS; this.tag = tagBad; }
    return { id, name, ok, score, tags };
  }

  records(): Row[] {
    this.clear(); this.skipWhitespace();
    const result: Row[] = [];
    if (this.peek() !== 91) { this.skipValue(); this.problem = ARRAY; this.field = ROWS; return result; }
    this.at++; this.skipWhitespace();
    if (this.peek() === 93) { this.at++; return result; }
    let bad = 0, field = ROOT, row = -1, tag = -1;
    for (;;) {
      const value = this.record(result.length);
      if (!bad && this.problem) { bad = this.problem; field = this.field; row = this.row; tag = this.tag; }
      result.push(value);
      if (this.separator(93)) break;
    }
    this.problem = bad; this.field = field; this.row = row; this.tag = tag;
    return result;
  }

  document(): Document {
    this.clear(); this.skipWhitespace();
    let rows: Row[] = [], count = 0;
    if (this.peek() !== 123) {
      this.skipValue(); this.clear(); this.problem = OBJECT;
      this.finish(); return { rows, count, note: null };
    }
    this.at++; this.skipWhitespace();
    let seen = 0, rowsBad = 0, rowsField = ROWS, badRow = -1, badTag = -1, countBad = 0, noteBad = 0;
    if (this.peek() === 125) this.at++;
    else for (;;) {
      const key = this.key();
      if (key === ROWS) {
        rows = this.records(); rowsBad = this.problem; rowsField = this.field;
        badRow = this.row; badTag = this.tag; seen |= 1;
      } else if (key === COUNT) { count = this.number(); countBad = this.problem; seen |= 2; }
      else if (key === NOTE) { this.nullValue(); noteBad = this.problem; seen |= 4; }
      else this.skipValue();
      if (this.separator(125)) break;
    }
    this.clear();
    if (!(seen & 1) || rowsBad) {
      this.problem = seen & 1 ? rowsBad : MISSING; this.field = seen & 1 ? rowsField : ROWS;
      this.row = badRow; this.tag = badTag;
    } else if (!(seen & 2) || countBad) { this.problem = seen & 2 ? countBad : MISSING; this.field = COUNT; }
    else if (!(seen & 4) || noteBad) { this.problem = seen & 4 ? noteBad : MISSING; this.field = NOTE; }
    this.finish(); return { rows, count, note: null };
  }

  finish(): void {
    this.skipWhitespace();
    if (this.at !== this.length) throw this.fail("Unexpected trailing text");
    if (!this.problem) return;
    let path = "$";
    if (this.row >= 0) path += ".rows[" + this.row + "]";
    if (this.field !== ROOT && !(this.field === ROWS && this.row >= 0)) path += "." + fieldName(this.field);
    if (this.tag >= 0) path += "[" + this.tag + "]";
    let expected = "object";
    if (this.problem === ARRAY) expected = "array";
    else if (this.problem === NUMBER) expected = "number";
    else if (this.problem === STRING) expected = "string";
    else if (this.problem === BOOLEAN) expected = "boolean";
    else if (this.problem === NULL) expected = "null";
    if (this.problem === MISSING) throw new TypeError("Missing required property at " + path);
    throw new TypeError("Expected " + expected + " at " + path);
  }
}

export function parseTypedDocument(text: string): Document {
  return new TypedReader(text).document();
}
