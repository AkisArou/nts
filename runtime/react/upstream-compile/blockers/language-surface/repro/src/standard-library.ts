export function encode(value: {readonly id: number}): string | undefined {
  return JSON.stringify(value);
}

export function token(): symbol {
  return Symbol.for('react.token');
}

export function aggregate(): AggregateError {
  return new AggregateError([], 'react errors');
}
