// Entities decode in text and in attribute strings, and only there; an
// unknown or unterminated one stays as written.
export function Entities({ name }: { name: string }) {
  return (
    <p title="a &amp; b &quot;c&quot; &#169; &#x263A; &bogus; & end" data-raw='{"x": 1}'>
      Hello   &nbsp; {name}
      &lt;tag&gt; &mdash; &#128512; done &amp
    </p>
  );
}
