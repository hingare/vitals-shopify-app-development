import { Inline } from "./RichText";

/** Questions as native disclosure widgets: keyboard friendly and no JavaScript needed. */
export function Faq({ items }: { items: Array<{ q: string; a: string }> }) {
  return (
    <div className="faq">
      {items.map((item) => (
        <details key={item.q}>
          <summary>{item.q}</summary>
          <p>
            <Inline text={item.a} />
          </p>
        </details>
      ))}
    </div>
  );
}
