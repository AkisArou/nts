// Unicode locale identifiers, rather than the wider RFC 5646 language-tag
// grammar accepted by ICU. Validation is shared; aliases come from ICU data.
function alphabetic(text: string): boolean {
  if (text.length === 0) return false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122))) return false;
  }
  return true;
}

function numeric(text: string): boolean {
  if (text.length === 0) return false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

function alphanumeric(text: string): boolean {
  if (text.length === 0) return false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (!((code >= 48 && code <= 57) || (code >= 97 && code <= 122))) return false;
  }
  return true;
}

export function validLanguage(language: string): boolean {
  const length = language.length;
  return ((length >= 2 && length <= 3) || (length >= 5 && length <= 8)) && alphabetic(language);
}

export function validScript(script: string): boolean {
  return script.length === 4 && alphabetic(script);
}

export function validRegion(region: string): boolean {
  return (region.length === 2 && alphabetic(region)) || (region.length === 3 && numeric(region));
}

export function validVariant(text: string): boolean {
  return (
    alphanumeric(text) &&
    ((text.length >= 5 && text.length <= 8) ||
      (text.length === 4 && text.charCodeAt(0) >= 48 && text.charCodeAt(0) <= 57))
  );
}

export function validUnicodeType(value: string): boolean {
  const parts = value.toLowerCase().split("-");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part.length < 3 || part.length > 8 || !alphanumeric(part)) return false;
  }
  return true;
}

class LocaleExtension {
  readonly singleton: string;
  readonly subtags: readonly string[];
  constructor(singleton: string, subtags: readonly string[]) {
    this.singleton = singleton;
    this.subtags = subtags;
  }
}

class LocaleKeyword {
  readonly key: string;
  readonly value: string;
  constructor(key: string, value: string) {
    this.key = key;
    this.value = value;
  }
}

function languageEnd(parts: readonly string[], from: number): number {
  if (from >= parts.length || !validLanguage(parts[from]!)) return from;
  let index = from + 1;
  if (index < parts.length && validScript(parts[index]!)) index++;
  if (index < parts.length && validRegion(parts[index]!)) index++;
  const variants = new Set<string>();
  while (index < parts.length && validVariant(parts[index]!)) {
    const value = parts[index]!;
    if (variants.has(value)) throw new RangeError("Duplicate locale variant");
    variants.add(value);
    index++;
  }
  return index;
}

function validateUnicode(parts: readonly string[]): void {
  let index = 0;
  while (index < parts.length && parts[index]!.length >= 3) index++;
  while (index < parts.length) {
    const key = parts[index++]!;
    // ukey is alphanum followed by alpha; a trailing digit is not a key.
    if (key.length !== 2 || !alphabetic(key.charAt(1)))
      throw new RangeError("Invalid Unicode locale extension key");
    while (index < parts.length && parts[index]!.length >= 3) index++;
  }
}

function validateTransformed(parts: readonly string[]): void {
  let index = languageEnd(parts, 0);
  while (index < parts.length) {
    const key = parts[index++]!;
    if (key.length !== 2 || !alphabetic(key.charAt(0)) || !numeric(key.charAt(1)))
      throw new RangeError("Invalid transformed locale extension key");
    const start = index;
    while (index < parts.length && parts[index]!.length >= 3) index++;
    if (start === index) throw new RangeError("Missing transformed locale extension value");
  }
}

// Internal parsed representation. It is neither a copied Intl.Locale contract
// nor a second alias database. It is used only during construction/resolution.
export class LocaleIdentifier {
  readonly language: string;
  readonly script: string | undefined;
  readonly region: string | undefined;
  readonly variants: readonly string[];
  private readonly extensions: readonly LocaleExtension[];
  readonly baseName: string;

  constructor(tag: string) {
    const parts = tag.toLowerCase().split("-");
    const baseEnd = languageEnd(parts, 0);
    if (baseEnd === 0) throw new RangeError("Invalid locale language");
    this.language = parts[0]!;
    let index = 1;
    if (index < baseEnd && validScript(parts[index]!)) {
      const script = parts[index++]!;
      this.script = script.charAt(0).toUpperCase() + script.slice(1);
    }
    if (index < baseEnd && validRegion(parts[index]!)) this.region = parts[index++]!.toUpperCase();
    this.variants = parts.slice(index, baseEnd);
    this.baseName =
      this.language +
      (this.script === undefined ? "" : "-" + this.script) +
      (this.region === undefined ? "" : "-" + this.region) +
      (this.variants.length === 0 ? "" : "-" + this.variants.join("-"));
    const extensions: LocaleExtension[] = [];
    const singletons = new Set<string>();
    index = baseEnd;
    while (index < parts.length) {
      const singleton = parts[index++]!;
      if (singleton.length !== 1 || !alphanumeric(singleton) || singletons.has(singleton))
        throw new RangeError("Invalid or duplicate locale extension");
      singletons.add(singleton);
      const start = index;
      while (index < parts.length && (singleton === "x" || parts[index]!.length !== 1)) {
        const part = parts[index++]!;
        if (part.length < (singleton === "x" ? 1 : 2) || part.length > 8 || !alphanumeric(part))
          throw new RangeError("Invalid locale extension subtag");
      }
      if (start === index) throw new RangeError("Empty locale extension");
      const subtags = parts.slice(start, index);
      if (singleton === "u") validateUnicode(subtags);
      else if (singleton === "t") validateTransformed(subtags);
      extensions.push(new LocaleExtension(singleton, subtags));
    }
    this.extensions = extensions;
  }

  keyword(key: string): string | undefined {
    for (let extension = 0; extension < this.extensions.length; extension++) {
      const entry = this.extensions[extension]!;
      if (entry.singleton !== "u") continue;
      const parts = entry.subtags;
      for (let index = 0; index < parts.length; index++) {
        if (parts[index] !== key) continue;
        const start = index + 1;
        let end = start;
        while (end < parts.length && parts[end]!.length >= 3) end++;
        return parts.slice(start, end).join("-");
      }
    }
    return undefined;
  }

  unicodeKeywords(): readonly LocaleKeyword[] {
    const result: LocaleKeyword[] = [];
    const seen = new Set<string>();
    for (let extension = 0; extension < this.extensions.length; extension++) {
      const entry = this.extensions[extension]!;
      if (entry.singleton !== "u") continue;
      const parts = entry.subtags;
      let index = 0;
      while (index < parts.length && parts[index]!.length >= 3) index++;
      while (index < parts.length) {
        const key = parts[index++]!;
        const start = index;
        while (index < parts.length && parts[index]!.length >= 3) index++;
        if (!seen.has(key)) {
          seen.add(key);
          result.push(new LocaleKeyword(key, parts.slice(start, index).join("-")));
        }
      }
    }
    return result;
  }

  // Retain private-use/other extensions when resolving service locales. Only
  // the Unicode extension is negotiated by a service constructor.
  withoutUnicode(): string {
    let result = this.baseName;
    for (let index = 0; index < this.extensions.length; index++) {
      const entry = this.extensions[index]!;
      if (entry.singleton !== "u") result += "-" + entry.singleton + "-" + entry.subtags.join("-");
    }
    return result;
  }

  withBase(
    language: string,
    script: string | undefined,
    region: string | undefined,
    variants: readonly string[] = this.variants,
  ): string {
    let result =
      language +
      (script === undefined ? "" : "-" + script) +
      (region === undefined ? "" : "-" + region) +
      (variants.length === 0 ? "" : "-" + variants.join("-"));
    for (let index = 0; index < this.extensions.length; index++) {
      const entry = this.extensions[index]!;
      result += "-" + entry.singleton + "-" + entry.subtags.join("-");
    }
    return result;
  }

  withKeyword(key: string, value: string): string {
    return this.withKeywords([key], [value]);
  }

  // Batch the constructor's fixed option keys so it parses the identifier and
  // sorts its extension once, rather than rebuilding it for every option.
  withKeywords(keys: readonly string[], values: readonly (string | undefined)[]): string {
    if (keys.length !== values.length) throw new Error("Locale keyword storage mismatch");
    const replacements: string[] = [];
    for (let index = 0; index < keys.length; index++) {
      const value = values[index];
      if (value !== undefined)
        replacements.push(keys[index]! + (value === "true" || value === "" ? "" : "-" + value));
    }
    if (replacements.length === 0) return this.withBase(this.language, this.script, this.region);
    let result = this.baseName;
    let inserted = false;
    for (let extension = 0; extension < this.extensions.length; extension++) {
      const entry = this.extensions[extension]!;
      if (entry.singleton === "x" && !inserted) {
        result += "-u-" + replacements.sort().join("-");
        inserted = true;
      }
      if (entry.singleton !== "u") {
        result += "-" + entry.singleton + "-" + entry.subtags.join("-");
        continue;
      }
      result += "-u";
      const parts = entry.subtags;
      let index = 0;
      while (index < parts.length && parts[index]!.length >= 3) result += "-" + parts[index++];
      const keywords: string[] = [];
      while (index < parts.length) {
        const start = index++;
        while (index < parts.length && parts[index]!.length >= 3) index++;
        let replaced = false;
        for (let replacement = 0; replacement < keys.length; replacement++)
          if (parts[start] === keys[replacement] && values[replacement] !== undefined)
            replaced = true;
        if (!replaced) keywords.push(parts.slice(start, index).join("-"));
      }
      for (let replacement = 0; replacement < replacements.length; replacement++)
        keywords.push(replacements[replacement]!);
      keywords.sort();
      result += "-" + keywords.join("-");
      inserted = true;
    }
    return inserted ? result : result + "-u-" + replacements.sort().join("-");
  }
}
