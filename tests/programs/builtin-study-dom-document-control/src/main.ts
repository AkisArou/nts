// Source control for builtin-study-dom-document. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
const sourceDocument = { title: "source" };

export function domDocumentControl(): string {
  return sourceDocument.title;
}
