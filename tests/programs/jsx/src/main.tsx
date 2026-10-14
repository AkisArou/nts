// JSX without React installed: a local JSX namespace is all the checker needs.
declare global {
  namespace JSX {
    interface IntrinsicElements {
      div: { id?: string };
    }
    interface Element {
      kind: string;
    }
  }
}

export interface Props {
  label: string;
  count: number;
}

export function Badge(props: Props): JSX.Element {
  return <div id={props.label} />;
}

export const rendered = <Badge label="x" count={1} />;
