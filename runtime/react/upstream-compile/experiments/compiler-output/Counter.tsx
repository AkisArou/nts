import {useState} from 'react';

type Props = {
  count: number;
  label: string;
};

export function Counter({count, label}: Props) {
  const [state, setState] = useState(0);
  const doubled = count * 2;
  return (
    <button onClick={() => setState(state + 1)}>
      {label}:{doubled + state}
    </button>
  );
}
