// A CommonJS module whose export is a class, for export-equals-class.ts.
class Shape {
  static created = 0;
  constructor(readonly sides: number) {
    Shape.created++;
  }
}
export = Shape;
