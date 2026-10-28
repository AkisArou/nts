import { installCheck, type Ops } from "./brand.ts";

export class Widget implements Ops {
  #isReady = true;

  static {
    installCheck(
      (value): value is Ops =>
        typeof value === "object" && value !== null && #isReady in value,
    );
  }

  get ready(): boolean {
    return this.#isReady;
  }
}
