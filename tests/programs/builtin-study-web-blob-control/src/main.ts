// Source control for builtin-study-web-blob. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
class SourceBlob { size: number; constructor(parts: string[]) { this.size = parts.join("").length; } }

export function webBlobControl(): number {
  return new SourceBlob(["abc"]).size;
}
