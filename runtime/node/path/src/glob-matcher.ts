// Glob-pattern compilation shared by `path.matchesGlob` and `fs.glob`.
//
// Node v24.20.0 routes both APIs through its bundled `minimatch`.  Importing
// that JavaScript bundle would also import CommonJS loaders, property
// descriptors and runtime iterator hooks that are outside the NTS object
// model.  This file keeps the part those APIs actually need: brace expansion,
// path-segment compilation, extglobs, character classes and globstar matching.
// Patterns are compiled once; matching then uses a fixed-size memo table rather
// than allocating during backtracking.

/** One `**` path component. It is deliberately not represented by a Symbol. */
export class GlobStar {
  readonly kind = "globstar";
}

export const globStar = new GlobStar();

/** A non-literal path component compiled to an anchored regular expression. */
export class GlobSegmentMatcher {
  readonly pattern: string;
  readonly expression: RegExp;
  readonly allowsEmpty: boolean;

  constructor(pattern: string) {
    this.pattern = pattern;
    const dot = startsWithExplicitDot(pattern) ? "" : "(?!\\.)";
    this.expression = new RegExp(`^${dot}${compileSequence(pattern, 0, pattern.length)}$`);
    this.allowsEmpty = !containsOnlyStars(pattern) && this.expression.test("");
  }

  test(value: string): boolean {
    // Magic never traverses the two directory-navigation components. Exact
    // literal `.` and `..` patterns are represented as strings instead.
    if (value === "." || value === "..") return false;
    if (value.length === 0 && !this.allowsEmpty) return false;
    return this.expression.test(value);
  }
}

export type GlobPart = string | GlobStar | GlobSegmentMatcher;

/** One brace-expanded and path-normalized alternative. */
export class CompiledGlobPattern {
  readonly parts: GlobPart[];
  readonly sourceParts: string[];

  constructor(sourceParts: string[]) {
    this.sourceParts = sourceParts;
    this.parts = new Array<GlobPart>(sourceParts.length);
    for (let index = 0; index < sourceParts.length; index++) {
      const part = sourceParts[index];
      if (part === undefined) throw new Error(`glob pattern is missing component ${index}`);
      this.parts[index] = compilePart(part);
    }
  }
}

function isExtglobOperator(character: string): boolean {
  return character === "?" || character === "*" || character === "+" ||
    character === "@" || character === "!";
}

function containsOnlyStars(pattern: string): boolean {
  if (pattern.length === 0) return false;
  for (let index = 0; index < pattern.length; index++) {
    if (pattern.charAt(index) !== "*") return false;
  }
  return true;
}

function regexpEscape(character: string): string {
  if (character === "\\" || character === "^" || character === "$" ||
      character === "." || character === "+" || character === "(" ||
      character === ")" || character === "|" || character === "{" ||
      character === "}") {
    return `\\${character}`;
  }
  return character;
}

function findClosingParenthesis(pattern: string, open: number, end: number): number {
  let depth = 1;
  let inClass = false;
  for (let index = open + 1; index < end; index++) {
    const character = pattern.charAt(index);
    if (character === "[" && !inClass) {
      inClass = true;
    } else if (character === "]" && inClass) {
      inClass = false;
    } else if (!inClass && character === "(") {
      depth++;
    } else if (!inClass && character === ")") {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitExtglobAlternatives(
  pattern: string,
  start: number,
  end: number,
): string[] {
  const alternatives: string[] = [];
  let depth = 0;
  let inClass = false;
  let alternativeStart = start;
  for (let index = start; index < end; index++) {
    const character = pattern.charAt(index);
    if (character === "[" && !inClass) {
      inClass = true;
    } else if (character === "]" && inClass) {
      inClass = false;
    } else if (!inClass && character === "(") {
      depth++;
    } else if (!inClass && character === ")") {
      depth--;
    } else if (!inClass && depth === 0 && character === "|") {
      alternatives.push(pattern.slice(alternativeStart, index));
      alternativeStart = index + 1;
    }
  }
  alternatives.push(pattern.slice(alternativeStart, end));
  return alternatives;
}

function compileExtglobAlternatives(alternatives: string[]): string {
  let result = "";
  for (let index = 0; index < alternatives.length; index++) {
    const alternative = alternatives[index];
    if (alternative === undefined) {
      throw new Error(`extglob is missing alternative ${index}`);
    }
    if (index !== 0) result += "|";
    result += compileSequence(alternative, 0, alternative.length);
  }
  return result;
}

function findClassEnd(pattern: string, open: number, end: number): number {
  // A closing bracket in the first position belongs to the class.
  let index = open + 1;
  if (pattern.charAt(index) === "!" || pattern.charAt(index) === "^") index++;
  if (pattern.charAt(index) === "]") index++;
  for (; index < end; index++) {
    if (pattern.charAt(index) === "]") return index;
  }
  return -1;
}

function compileCharacterClass(body: string): string {
  let result = "[";
  let index = 0;
  if (body.charAt(0) === "!" || body.charAt(0) === "^") {
    result += "^";
    index = 1;
  }
  for (; index < body.length; index++) {
    const character = body.charAt(index);
    if (character === "\\") result += "\\\\";
    else result += character;
  }
  result += "]";
  return result;
}

/** Compile one component. Negative extglobs include the remaining suffix. */
function compileSequence(pattern: string, start: number, end: number): string {
  let result = "";
  let index = start;
  while (index < end) {
    const character = pattern.charAt(index);
    const next = pattern.charAt(index + 1);

    if (isExtglobOperator(character) && next === "(") {
      const close = findClosingParenthesis(pattern, index + 1, end);
      if (close !== -1) {
        const alternatives = splitExtglobAlternatives(pattern, index + 2, close);
        const compiled = compileExtglobAlternatives(alternatives);
        const suffix = compileSequence(pattern, close + 1, end);
        if (character === "!") {
          // The assertion covers the complete rest of the component. This is
          // minimatch's important distinction from merely negating one token.
          return `${result}(?!(?:${compiled})${suffix}$)[^/]*?${suffix}`;
        }
        if (character === "+") result += `(?:${compiled})+`;
        else if (character === "*") result += `(?:${compiled})*`;
        else if (character === "?") result += `(?:${compiled})?`;
        else result += `(?:${compiled})`;
        result += suffix;
        return result;
      }
    }

    if (character === "*") {
      while (pattern.charAt(index + 1) === "*") index++;
      result += "[^/]*?";
    } else if (character === "?") {
      result += "[^/]";
    } else if (character === "[") {
      const close = findClassEnd(pattern, index, end);
      if (close === -1) {
        result += "\\[";
      } else {
        result += compileCharacterClass(pattern.slice(index + 1, close));
        index = close;
      }
    } else {
      result += regexpEscape(character);
    }
    index++;
  }
  return result;
}

function classIsOnlyDot(pattern: string): boolean {
  return pattern.length >= 3 && pattern.charAt(0) === "[" &&
    pattern.charAt(1) === "." && pattern.charAt(2) === "]";
}

function startsWithExplicitDot(pattern: string): boolean {
  if (pattern.charAt(0) === "." || classIsOnlyDot(pattern)) return true;
  if (!isExtglobOperator(pattern.charAt(0)) || pattern.charAt(1) !== "(") {
    return false;
  }
  if (pattern.charAt(0) === "!") return false;
  const close = findClosingParenthesis(pattern, 1, pattern.length);
  if (close === -1) return false;
  const alternatives = splitExtglobAlternatives(pattern, 2, close);
  for (let index = 0; index < alternatives.length; index++) {
    const alternative = alternatives[index];
    if (alternative !== undefined && startsWithExplicitDot(alternative)) return true;
  }
  return false;
}

function hasMagic(part: string): boolean {
  for (let index = 0; index < part.length; index++) {
    const character = part.charAt(index);
    if (character === "*" || character === "?" || character === "[") return true;
    if (isExtglobOperator(character) && part.charAt(index + 1) === "(") return true;
  }
  return false;
}

function compilePart(part: string): GlobPart {
  if (part === "**") return globStar;
  if (!hasMagic(part)) return part;
  return new GlobSegmentMatcher(part);
}

function findBalancedBrace(pattern: string, open: number): number {
  let depth = 1;
  let inClass = false;
  let parenthesisDepth = 0;
  for (let index = open + 1; index < pattern.length; index++) {
    const character = pattern.charAt(index);
    if (character === "[" && !inClass) {
      inClass = true;
    } else if (character === "]" && inClass) {
      inClass = false;
    } else if (!inClass && character === "(") {
      parenthesisDepth++;
    } else if (!inClass && character === ")" && parenthesisDepth > 0) {
      parenthesisDepth--;
    } else if (!inClass && parenthesisDepth === 0 && character === "{") {
      depth++;
    } else if (!inClass && parenthesisDepth === 0 && character === "}") {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitBraceAlternatives(body: string): string[] | undefined {
  const alternatives: string[] = [];
  let depth = 0;
  let inClass = false;
  let parenthesisDepth = 0;
  let start = 0;
  let hasComma = false;
  for (let index = 0; index < body.length; index++) {
    const character = body.charAt(index);
    if (character === "[" && !inClass) {
      inClass = true;
    } else if (character === "]" && inClass) {
      inClass = false;
    } else if (!inClass && character === "(") {
      parenthesisDepth++;
    } else if (!inClass && character === ")" && parenthesisDepth > 0) {
      parenthesisDepth--;
    } else if (!inClass && parenthesisDepth === 0 && character === "{") {
      depth++;
    } else if (!inClass && parenthesisDepth === 0 && character === "}") {
      depth--;
    } else if (!inClass && parenthesisDepth === 0 && depth === 0 && character === ",") {
      alternatives.push(body.slice(start, index));
      start = index + 1;
      hasComma = true;
    }
  }
  if (!hasComma) return expandBraceRange(body);
  alternatives.push(body.slice(start));
  return alternatives;
}

function parseInteger(text: string): number | undefined {
  if (text.length === 0) return undefined;
  let index = text.charAt(0) === "-" ? 1 : 0;
  if (index === text.length) return undefined;
  for (; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 48 || code > 57) return undefined;
  }
  return Number(text);
}

function expandBraceRange(body: string): string[] | undefined {
  const fields = body.split("..");
  if (fields.length < 2 || fields.length > 3) return undefined;
  const firstText = fields[0];
  const lastText = fields[1];
  if (firstText === undefined || lastText === undefined) return undefined;
  const explicitStep = fields[2] === undefined ? undefined : parseInteger(fields[2]);

  const firstNumber = parseInteger(firstText);
  const lastNumber = parseInteger(lastText);
  let first: number;
  let last: number;
  let numeric = false;
  if (firstNumber !== undefined && lastNumber !== undefined) {
    first = firstNumber;
    last = lastNumber;
    numeric = true;
  } else if (firstText.length === 1 && lastText.length === 1) {
    first = firstText.charCodeAt(0);
    last = lastText.charCodeAt(0);
  } else {
    return undefined;
  }

  let step = explicitStep === undefined ? 1 : Math.abs(explicitStep);
  if (step === 0) step = 1;
  if (last < first) step = -step;
  const width = numeric ? Math.max(firstText.length, lastText.length) : 0;
  const values: string[] = [];
  for (let value = first; step > 0 ? value <= last : value >= last; value += step) {
    if (numeric) {
      const negative = value < 0;
      let result = String(Math.abs(value));
      const digits = width - (negative ? 1 : 0);
      while (result.length < digits) result = `0${result}`;
      values.push(negative ? `-${result}` : result);
    } else {
      values.push(String.fromCharCode(value));
    }
  }
  return values;
}

function expandBracesInto(pattern: string, output: string[]): void {
  let open = -1;
  for (let index = 0; index < pattern.length; index++) {
    if (pattern.charAt(index) === "{") {
      open = index;
      break;
    }
  }
  if (open === -1) {
    output.push(pattern);
    return;
  }
  const close = findBalancedBrace(pattern, open);
  if (close === -1) {
    output.push(pattern);
    return;
  }
  const alternatives = splitBraceAlternatives(pattern.slice(open + 1, close));
  if (alternatives === undefined) {
    // A non-expanding brace pair is literal. Continue after it so a later
    // expanding pair is still found.
    const prefix = pattern.slice(0, close + 1);
    const suffix: string[] = [];
    expandBracesInto(pattern.slice(close + 1), suffix);
    for (let index = 0; index < suffix.length; index++) {
      const value = suffix[index];
      if (value !== undefined) output.push(prefix + value);
    }
    return;
  }
  const prefix = pattern.slice(0, open);
  const suffix = pattern.slice(close + 1);
  for (let index = 0; index < alternatives.length; index++) {
    const alternative = alternatives[index];
    if (alternative !== undefined) expandBracesInto(prefix + alternative + suffix, output);
  }
}

/** Node/minimatch collapses repeated separators before compiling components. */
function splitPattern(pattern: string, windows: boolean): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let index = 0; index <= pattern.length; index++) {
    const character = pattern.charAt(index);
    const separator = index === pattern.length || character === "/" ||
      (windows && character === "\\");
    if (!separator) continue;
    if (index !== start || start === 0 || index === pattern.length) {
      parts.push(pattern.slice(start, index));
    }
    while (index + 1 < pattern.length &&
      (pattern.charAt(index + 1) === "/" ||
       (windows && pattern.charAt(index + 1) === "\\"))) index++;
    start = index + 1;
  }
  return parts;
}

/** Minimatch's level-two preprocessing, optimized for filesystem walking. */
function preprocessPatternParts(initial: string[]): string[][] {
  const patterns: string[][] = [initial];
  let changed: boolean;
  do {
    changed = false;
    for (let patternIndex = 0; patternIndex < patterns.length; patternIndex++) {
      const parts = patterns[patternIndex];
      if (parts === undefined) throw new Error(`glob is missing pattern ${patternIndex}`);

      let globstar = -1;
      while ((globstar = parts.indexOf("**", globstar + 1)) !== -1) {
        let finalGlobstar = globstar;
        while (parts[finalGlobstar + 1] === "**") finalGlobstar++;
        if (finalGlobstar > globstar) {
          parts.splice(globstar + 1, finalGlobstar - globstar);
          changed = true;
        }

        const next = parts[globstar + 1];
        const afterParent = parts[globstar + 2];
        const following = parts[globstar + 3];
        if (next !== ".." || afterParent === undefined || afterParent === "" ||
            afterParent === "." || afterParent === ".." || following === undefined ||
            following === "" || following === "." || following === "..") {
          continue;
        }

        // `<pre>/**/../<p>/<p>/<rest>` is the union of walking out of
        // `<pre>` and keeping the recursive walk below it. Expanding that
        // union avoids repeatedly restarting a filesystem traversal.
        changed = true;
        parts.splice(globstar, 1);
        const recursive = parts.slice();
        recursive[globstar] = "**";
        patterns.push(recursive);
        globstar--;
      }

      for (let index = 1; index < parts.length - 1; index++) {
        const part = parts[index];
        if (part === "." || part === "") {
          parts.splice(index, 1);
          index--;
          changed = true;
        }
      }
      if (parts[0] === "." && parts.length === 2 &&
          (parts[1] === "." || parts[1] === "")) {
        parts.pop();
        changed = true;
      }

      let parent = 0;
      while ((parent = parts.indexOf("..", parent + 1)) !== -1) {
        const previous = parts[parent - 1];
        if (previous !== undefined && previous !== "" && previous !== "." &&
            previous !== ".." && previous !== "**") {
          const keepDot = parent === 1 && parts[parent + 1] === "**";
          if (keepDot) parts.splice(parent - 1, 2, ".");
          else parts.splice(parent - 1, 2);
          if (parts.length === 0) parts.push("");
          parent -= 2;
          changed = true;
        }
      }
    }
  } while (changed);
  return patterns;
}

export function compileGlobPatterns(
  pattern: string,
  windows: boolean,
): CompiledGlobPattern[] {
  const expanded: string[] = [];
  expandBracesInto(pattern, expanded);
  const componentPatterns: string[][] = [];
  for (let index = 0; index < expanded.length; index++) {
    const alternative = expanded[index];
    if (alternative === undefined) throw new Error(`glob is missing alternative ${index}`);
    const preprocessed = preprocessPatternParts(splitPattern(alternative, windows));
    for (let patternIndex = 0; patternIndex < preprocessed.length; patternIndex++) {
      const parts = preprocessed[patternIndex];
      if (parts !== undefined) componentPatterns.push(parts);
    }
  }
  const compiled = new Array<CompiledGlobPattern>(componentPatterns.length);
  for (let index = 0; index < componentPatterns.length; index++) {
    const parts = componentPatterns[index];
    if (parts === undefined) throw new Error(`glob is missing component pattern ${index}`);
    compiled[index] = new CompiledGlobPattern(parts);
  }
  return compiled;
}

function splitValue(path: string, windows: boolean): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let index = 0; index <= path.length; index++) {
    const character = path.charAt(index);
    const separator = index === path.length || character === "/" ||
      (windows && character === "\\");
    if (!separator) continue;
    parts.push(path.slice(start, index));
    while (index + 1 < path.length &&
      (path.charAt(index + 1) === "/" ||
       (windows && path.charAt(index + 1) === "\\"))) index++;
    start = index + 1;
  }
  const optimized: string[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part === undefined) throw new Error(`path is missing component ${index}`);
    if (part === ".." && optimized.length > 0) {
      const previous = optimized[optimized.length - 1];
      if (previous !== "" && previous !== "." && previous !== "..") {
        optimized.pop();
      } else {
        optimized.push(part);
      }
    } else {
      optimized.push(part);
    }
  }
  if (optimized.length === 0) optimized.push("");
  return optimized;
}

function partMatches(part: GlobPart, value: string): boolean {
  if (typeof part === "string") return part === value;
  if (part instanceof GlobSegmentMatcher) return part.test(value);
  return false;
}

function patternMatches(parts: GlobPart[], values: string[]): boolean {
  const columns = values.length + 1;
  const memo = new Array<number>((parts.length + 1) * columns).fill(0);

  function visit(patternIndex: number, valueIndex: number): boolean {
    const memoIndex = patternIndex * columns + valueIndex;
    const known = memo[memoIndex];
    if (known === 1) return false;
    if (known === 2) return true;

    let matches: boolean;
    if (patternIndex === parts.length) {
      matches = valueIndex === values.length ||
        (valueIndex + 1 === values.length && values[valueIndex] === "");
    } else {
      const part = parts[patternIndex];
      if (part instanceof GlobStar) {
        // A terminal globstar denotes something below the preceding slash.
        // Thus `**` consumes the empty path component, while `a/**` does not
        // match bare `a` but does match `a/`.
        if (patternIndex + 1 === parts.length) {
          matches = valueIndex < values.length;
          for (let index = valueIndex; matches && index < values.length; index++) {
            const value = values[index];
            matches = value !== undefined &&
              (value === "" || (value !== "." && value !== ".." && value.charAt(0) !== "."));
          }
        } else {
          matches = visit(patternIndex + 1, valueIndex);
          if (!matches && valueIndex < values.length) {
            const value = values[valueIndex];
            matches = value !== undefined &&
              (value === "" || (value !== "." && value !== ".." && value.charAt(0) !== ".")) &&
              visit(patternIndex, valueIndex + 1);
          }
        }
      } else if (part !== undefined && valueIndex < values.length) {
        const value = values[valueIndex];
        matches = value !== undefined && partMatches(part, value) &&
          visit(patternIndex + 1, valueIndex + 1);
      } else {
        matches = false;
      }
    }
    memo[memoIndex] = matches ? 2 : 1;
    return matches;
  }

  return visit(0, 0);
}

/** The fixed-option matcher used by Node v24's `path.matchesGlob`. */
export function matchesGlobPattern(
  path: string,
  pattern: string,
  windows: boolean,
): boolean {
  const alternatives = compileGlobPatterns(pattern, windows);
  return matchesCompiledGlobPatterns(path, alternatives, windows);
}

/** Match using an already compiled pattern list, for filesystem exclusions. */
export function matchesCompiledGlobPatterns(
  path: string,
  alternatives: CompiledGlobPattern[],
  windows: boolean,
): boolean {
  const values = splitValue(path, windows);
  for (let index = 0; index < alternatives.length; index++) {
    const alternative = alternatives[index];
    if (alternative !== undefined && patternMatches(alternative.parts, values)) return true;
  }
  return false;
}
