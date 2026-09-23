import { FAQ } from "@/lib/faq";

export function Faq() {
  return (
    <div className="faq">
      {FAQ.map((item) => (
        <details key={item.q} name="faq">
          <summary>
            {item.q}
            <span className="faq-plus" aria-hidden="true" />
          </summary>
          <div className="faq-a">
            <p>{item.a}</p>
          </div>
        </details>
      ))}
    </div>
  );
}

export const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
};
