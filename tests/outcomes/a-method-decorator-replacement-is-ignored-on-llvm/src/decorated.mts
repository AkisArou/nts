function doubled(target: () => number): () => number {
 return function (): number { return target() * 2; };
}
export class Thing { @doubled value(): number { return 5; } }
export class Plain { value(): number { return 5; } }
