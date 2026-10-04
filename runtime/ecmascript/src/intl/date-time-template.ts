export class DateTimeTemplate {
  readonly prefix: string;
  readonly separator: string;
  readonly suffix: string;
  readonly firstArgument: 0 | 1;
  constructor(pattern: string, syntax: "simple" | "ldml" = "simple") {
    let quoted = false;
    let count = 0;
    let seen = 0;
    let first: 0 | 1 = 0;
    let prefix = "";
    let separator = "";
    let suffix = "";
    // Interval fallbacks use SimpleFormatter: only braces start a quote.
    // Date/time connectors remain LDML patterns: every apostrophe quotes text.
    // Both grammars turn doubled apostrophes into one literal apostrophe.
    for (let index = 0; index < pattern.length; index++) {
      const symbol = pattern.charAt(index);
      if (symbol === "'") {
        const next = pattern.charAt(index + 1);
        if (next === "'") index++;
        else if (quoted) {
          quoted = false;
          continue;
        } else if (syntax === "ldml" || next === "{" || next === "}") {
          quoted = true;
          continue;
        }
      } else if (!quoted && symbol === "{") {
        const argument = pattern.charAt(index + 1);
        if ((argument !== "0" && argument !== "1") || pattern.charAt(index + 2) !== "}")
          throw new RangeError("Invalid date/time template argument");
        const position = argument === "0" ? 0 : 1;
        if (seen & (1 << position)) throw new RangeError("Duplicate date/time template argument");
        if (count === 0) first = position;
        seen |= 1 << position;
        count++;
        index += 2;
        continue;
      }
      if (count === 0) prefix += symbol;
      else if (count === 1) separator += symbol;
      else suffix += symbol;
    }
    if (quoted && syntax === "ldml") throw new RangeError("Unterminated date/time template quote");
    if (count !== 2) throw new RangeError("Date/time template requires both arguments");
    this.firstArgument = first;
    this.prefix = prefix;
    this.separator = separator;
    this.suffix = suffix;
  }
}
