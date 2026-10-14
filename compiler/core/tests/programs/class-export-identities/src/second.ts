export class Same {
  flag: boolean;
  constructor(flag: boolean) { this.flag = !flag; }
  get(): boolean { return this.flag; }
}
