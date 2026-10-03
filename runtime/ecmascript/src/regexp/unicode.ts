import { encodedTable, tableMode } from "./unicode-data.ts";

class Varints {
  readonly text: string;
  private at = 0;
  private buffer = 0;
  private bits = 0;
  constructor(text: string) {
    this.text = text;
  }

  private byte(): number {
    while (this.bits < 8) {
      const c = this.text.charCodeAt(this.at++);
      const value =
        c >= 65 && c <= 90
          ? c - 65
          : c >= 97 && c <= 122
            ? c - 71
            : c >= 48 && c <= 57
              ? c + 4
              : c === 43
                ? 62
                : c === 47
                  ? 63
                  : -1;
      if (value < 0) throw new Error("Invalid generated Unicode payload");
      this.buffer = (this.buffer << 6) | value;
      this.bits += 6;
    }
    this.bits -= 8;
    const result = (this.buffer >>> this.bits) & 255;
    this.buffer &= (1 << this.bits) - 1;
    return result;
  }

  read(): number {
    let result = 0;
    let scale = 1;
    for (let i = 0; i < 5; i++) {
      const byte = this.byte();
      result += (byte & 127) * scale;
      if (byte < 128) return result;
      scale *= 128;
    }
    throw new Error("Invalid generated Unicode varint");
  }
}

/** A compilation owns its decoded, immutable tables; no process-global cache. */
export class UnicodeDatabase {
  private ids: number[] = [];
  private tables: Uint32Array[] = [];

  get(id: number): Uint32Array {
    const cached = this.ids.indexOf(id);
    if (cached >= 0) return this.tables[cached]!;
    const reader = new Varints(encodedTable(id));
    const result = new Uint32Array(reader.read());
    const mode = tableMode(id);
    let previous = 0;
    for (let i = 0; i < result.length; i++) {
      let value = reader.read();
      if (mode === 1 || (mode === 2 && (i & 1) === 0)) {
        value += previous;
        previous = value;
      }
      result[i] = value;
    }
    this.ids.push(id);
    this.tables.push(result);
    return result;
  }
}
