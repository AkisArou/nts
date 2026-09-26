export type Props = { [key: string]: unknown };

export abstract class HostNode {
  readonly type: string;

  constructor(type: string) {
    this.type = type;
  }

  abstract setProp(key: string, value: unknown): boolean;

  applyProps(previous: Props | null, next: Props): void {
    for (const key in next) {
      const value = next[key];
      if (value !== undefined && (previous === null || previous[key] !== value)) {
        this.apply(key, value);
      }
    }
  }

  private apply(key: string, value: unknown): void {
    if (!this.setProp(key, value)) {
      throw new Error(`<${this.type}> has no prop \`${key}\`.`);
    }
  }
}
