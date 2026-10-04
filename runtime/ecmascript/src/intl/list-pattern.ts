// Locale data is loaded once. TypeScript owns list assembly and the contextual
// pattern rules, including empty elements that ICU field iteration drops.
import type { ListPatternData } from "./list-data.ts";

// The pinned CLDR start/middle templates have no outer affixes. Pair/end
// templates can have them (e.g. Māori "or"). Public ICU formatting resolves
// aliases and regional inheritance without depending on private resource APIs.
// Hebrew starters select the ordinary Hebrew conjunction; Spanish is ordinary
// too. Noncharacters keep the tokens distinct from locale literals.
function localePatterns(samples: readonly string[], tokens: readonly string[]): string[] {
  if (samples.length !== 3) throw new RangeError("Locale list samples are missing");
  const positions = new Array<number[]>(3);
  for (let sample = 0; sample < 3; sample++) {
    const text = samples[sample]!;
    const offsets = new Array<number>(sample + 2);
    let end = 0;
    for (let index = 0; index < offsets.length; index++) {
      const token = tokens[index]!;
      const offset = text.indexOf(token, end);
      if (offset < 0 || text.indexOf(token, offset + token.length) >= 0)
        throw new RangeError("Invalid locale list sample");
      offsets[index] = offset;
      end = offset + token.length;
    }
    positions[sample] = offsets;
  }
  const tokenLength = tokens[0]!.length;
  const pair = samples[0]!;
  const triple = samples[1]!;
  const quadruple = samples[2]!;
  const two = positions[0]!;
  const three = positions[1]!;
  const four = positions[2]!;
  const between = (text: string, offsets: number[], index: number): string =>
    text.slice(offsets[index]! + tokenLength, offsets[index + 1]!);
  const prefix = triple.slice(0, three[0]!);
  const suffix = triple.slice(three[2]! + tokenLength);
  const start = between(triple, three, 0);
  const end = between(triple, three, 1);
  if (
    prefix !== "" ||
    quadruple.slice(0, four[0]!) !== prefix ||
    quadruple.slice(four[3]! + tokenLength) !== suffix ||
    between(quadruple, four, 0) !== start ||
    between(quadruple, four, 2) !== end
  )
    throw new RangeError("Unsupported locale list template layout");
  return [
    pair.slice(0, two[0]!) +
      "{0}" +
      between(pair, two, 0) +
      "{1}" +
      pair.slice(two[1]! + tokenLength),
    "{0}" + start + "{1}",
    "{0}" + between(quadruple, four, 1) + "{1}",
    prefix + "{0}" + end + "{1}" + suffix,
  ];
}

class ListPattern {
  readonly prefix: string;
  readonly between: string;
  readonly suffix: string;
  readonly literalCount: number;
  constructor(pattern: string) {
    const first = pattern.indexOf("{0}");
    const second = pattern.indexOf("{1}");
    if (
      first < 0 ||
      second < first + 3 ||
      pattern.indexOf("{0}", first + 3) >= 0 ||
      pattern.indexOf("{1}", second + 3) >= 0
    )
      throw new RangeError("Invalid locale list template");
    this.prefix = pattern.slice(0, first);
    this.between = pattern.slice(first + 3, second);
    this.suffix = pattern.slice(second + 3);
    this.literalCount =
      Number(this.prefix.length !== 0) +
      Number(this.between.length !== 0) +
      Number(this.suffix.length !== 0);
  }
}

export class ListPatterns<D extends ListPatternData> {
  readonly #data: D;
  readonly #pair: ListPattern;
  readonly #start: ListPattern;
  readonly #middle: ListPattern;
  readonly #end: ListPattern;
  readonly #alternatePair: ListPattern;
  readonly #alternateEnd: ListPattern;
  readonly #context: number;

  constructor(data: D, locale: string, type: number, style: number) {
    const tokens = ["א\uffff0", "א\uffff1", "א\uffff2", "א\uffff3"];
    const patterns = localePatterns(data.listSamples(locale, type, style, tokens), tokens);
    const pair = patterns[0]!;
    const end = patterns[3]!;
    this.#pair = new ListPattern(pair);
    this.#start = new ListPattern(patterns[1]!);
    this.#middle = new ListPattern(patterns[2]!);
    this.#end = new ListPattern(end);
    const separator = locale.indexOf("-");
    const language = separator < 0 ? locale : locale.slice(0, separator);
    const base =
      language === "es" && (pair === "{0} y {1}" || end === "{0} y {1}")
        ? "{0} y {1}"
        : language === "es" && (pair === "{0} o {1}" || end === "{0} o {1}")
          ? "{0} o {1}"
          : (language === "he" || language === "iw") && (pair === "{0} ו{1}" || end === "{0} ו{1}")
            ? "{0} ו{1}"
            : "";
    const context =
      base === "{0} y {1}" ? 1 : base === "{0} o {1}" ? 2 : base === "{0} ו{1}" ? 3 : 0;
    const alternate = context === 1 ? "{0} e {1}" : context === 2 ? "{0} u {1}" : "{0} ו-{1}";
    this.#alternatePair = base !== "" && pair === base ? new ListPattern(alternate) : this.#pair;
    this.#alternateEnd = base !== "" && end === base ? new ListPattern(alternate) : this.#end;
    this.#context = context;
    this.#data = data;
  }

  private terminal(count: number, last: string): ListPattern {
    // Context predicates follow pinned ICU 78.3 ListFormatter. Its Unicode
    // redistribution notice is in runtime/ecmascript/third_party/ICU-LICENSE.
    let alternate = false;
    if (last.length !== 0) {
      const first = last.charCodeAt(0) | 32;
      const second = last.charCodeAt(1) | 32;
      const third = last.charCodeAt(2) | 32;
      if (this.#context === 1)
        alternate =
          first === 105 || (first === 104 && second === 105 && third !== 97 && third !== 101);
      else if (this.#context === 2)
        alternate =
          first === 111 ||
          last.charAt(0) === "8" ||
          (first === 104 && second === 111) ||
          (last.startsWith("11") && (last.length === 2 || last.charAt(2) === " "));
      else if (this.#context === 3) alternate = !this.#data.isHebrew(last.codePointAt(0)!);
    }
    return count === 2
      ? alternate
        ? this.#alternatePair
        : this.#pair
      : alternate
        ? this.#alternateEnd
        : this.#end;
  }
  private at(index: number, count: number, terminal: ListPattern): ListPattern {
    return index === count - 1 ? terminal : index === 1 ? this.#start : this.#middle;
  }
  private size(count: number, terminal: ListPattern): number {
    return (
      count +
      terminal.literalCount +
      (count > 2 ? this.#start.literalCount + (count - 3) * this.#middle.literalCount : 0)
    );
  }

  format(items: readonly string[]): string {
    const count = items.length;
    if (count < 2) return count === 0 ? "" : items[0]!;
    const terminal = this.terminal(count, items[count - 1]!);
    const segments = new Array<string>(this.size(count, terminal));
    let position = 0;
    for (let index = 1; index < count; index++) {
      const pattern = this.at(index, count, terminal);
      if (pattern.prefix !== "") segments[position++] = pattern.prefix;
      segments[position++] = items[index - 1]!;
      if (pattern.between !== "") segments[position++] = pattern.between;
    }
    segments[position++] = items[count - 1]!;
    for (let index = count - 1; index >= 1; index--) {
      const suffix = this.at(index, count, terminal).suffix;
      if (suffix !== "") segments[position++] = suffix;
    }
    return segments.join("");
  }

  formatToParts(items: readonly string[]): ReturnType<Intl.ListFormat["formatToParts"]> {
    const count = items.length;
    if (count === 0) return [];
    if (count === 1) return [{ type: "element", value: items[0]! }];
    const terminal = this.terminal(count, items[count - 1]!);
    const parts = new Array<ReturnType<Intl.ListFormat["formatToParts"]>[number]>(
      this.size(count, terminal),
    );
    let position = 0;
    for (let index = 1; index < count; index++) {
      const pattern = this.at(index, count, terminal);
      if (pattern.prefix !== "") parts[position++] = { type: "literal", value: pattern.prefix };
      parts[position++] = { type: "element", value: items[index - 1]! };
      if (pattern.between !== "") parts[position++] = { type: "literal", value: pattern.between };
    }
    parts[position++] = { type: "element", value: items[count - 1]! };
    for (let index = count - 1; index >= 1; index--) {
      const suffix = this.at(index, count, terminal).suffix;
      if (suffix !== "") parts[position++] = { type: "literal", value: suffix };
    }
    return parts;
  }
}
