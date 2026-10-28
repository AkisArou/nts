// Source control for builtin-study-web-textencoder. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
class SourceEncoder { encode(value: string): Uint8Array { const result = new Uint8Array(value.length + 1); result[0] = value.charCodeAt(0); return result; } }

export function webTextencoderControl(): string {
  const e = new SourceEncoder().encode("hé"); return e.length + ":" + e[0];
}
