type Props = {
  enabled: boolean;
  primary: string;
  secondary: string;
};

export function Branching({enabled, primary, secondary}: Props) {
  const label = enabled ? primary : secondary;
  return <label>{label.toUpperCase()}</label>;
}
