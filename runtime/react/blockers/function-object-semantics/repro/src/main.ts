type ComponentInstance = {
  props: number;
  isReactComponent: object;
  setState(value: number): void;
};

function Component(this: ComponentInstance, props: number): void {
  this.props = props;
}

Component.prototype.isReactComponent = {};
Component.prototype.setState = function (
  this: ComponentInstance,
  value: number,
): void {
  this.props = value;
};

export {Component};
