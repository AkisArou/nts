// run: build
// Reduced from Octane Navier–Stokes's constructor-local uiCallback slot.
// The control changes only the callback initializer to a function parameter.
interface Field {
  getDensity: (x: number, y: number) => number;
}
class FluidField {
  declare update: () => void;
  declare setUICallback: (callback: (field: Field) => void) => void;
  constructor(initial: (field: Field) => void) {
    var uiCallback = initial;
    class Field {
      declare getDensity: (x: number, y: number) => number;
      constructor() {
        this.getDensity = function (x: number, y: number): number {
          return x * 10 + y;
        };
      }
    }
    function queryUI(): void {
      uiCallback(new Field());
    }
    this.update = function (): void {
      queryUI();
    };
    this.setUICallback = function (callback: (field: Field) => void): void {
      uiCallback = callback;
    };
  }
}
let result = 0;
const solver = new FluidField(function (_field: Field): void {});
solver.setUICallback(function (field: Field): void {
  result = field.getDensity(2, 3);
});
solver.update();
observe("replacement callback", String(result));
done();
