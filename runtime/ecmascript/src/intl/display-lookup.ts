import type { LocaleData } from "./locale-data.ts";
import type { DisplayNamesPrimitive } from "./display-data.ts";
import { displayNameCode, displayNameField } from "./display-code.ts";
import { stringValue } from "./options.ts";

export class DisplayNameLookup<D extends LocaleData, P extends DisplayNamesPrimitive> {
  readonly #data: D;
  readonly #primitive: P;
  readonly #type: Intl.DisplayNamesType;
  readonly #fallback: Intl.DisplayNamesFallback;
  readonly #fields: (string | undefined)[] | undefined;
  #knownFields = 0;
  // ICU may allocate while assembling a name. Keep a bounded working set;
  // arbitrary valid language codes must never grow the formatter indefinitely.
  #codes: string[] | undefined;
  #names: (string | undefined)[] | undefined;
  #cached = 0;
  #next = 0;

  constructor(
    data: D,
    primitive: P,
    type: Intl.DisplayNamesType,
    fallback: Intl.DisplayNamesFallback,
  ) {
    this.#data = data;
    this.#primitive = primitive;
    this.#type = type;
    this.#fallback = fallback;
    if (type === "dateTimeField") this.#fields = new Array<string | undefined>(12);
  }

  of(code: string): string | undefined {
    const primitive = this.#primitive;
    const text = stringValue(code);
    let canonical: string;
    let name: string | undefined;
    if (this.#type === "dateTimeField") {
      const field = displayNameField(text);
      const mask = 1 << field;
      const fields = this.#fields!;
      if ((this.#knownFields & mask) === 0) {
        fields[field] = primitive.name(text, field);
        this.#knownFields |= mask;
      }
      canonical = text;
      name = fields[field];
    } else {
      const validated = displayNameCode(this.#type, text);
      canonical = this.#type === "language" ? this.#data.canonicalize(validated) : validated;
      const codes = this.#codes;
      let cached = -1;
      if (codes !== undefined) {
        for (let index = 0; index < this.#cached; index++) {
          if (codes[index] === canonical) {
            cached = index;
            break;
          }
        }
      }
      if (cached >= 0) name = this.#names![cached];
      else {
        name = primitive.name(canonical, -1);
        if (codes === undefined) {
          this.#codes = new Array<string>(8);
          this.#names = new Array<string | undefined>(8);
        }
        const next = this.#next;
        this.#codes![next] = canonical;
        this.#names![next] = name;
        this.#next = (next + 1) % 8;
        if (this.#cached < 8) this.#cached++;
      }
    }
    return name === undefined && this.#fallback === "code" ? canonical : name;
  }
}
