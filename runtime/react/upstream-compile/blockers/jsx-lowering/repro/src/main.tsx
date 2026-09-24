declare global {
  namespace JSX {
    interface IntrinsicElements {
      button: {label: string};
    }
    interface Element {
      kind: string;
    }
  }
}

export function Button(label: string): JSX.Element {
  return <button label={label} />;
}
