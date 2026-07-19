interface Category {
  id: string;
  title: string;
  blurb: string;
  available: boolean;
}

const CATEGORIES: Category[] = [
  {
    id: 'prd-review',
    title: 'PRD Review',
    blurb: 'Walk engineers, architects, and senior ICs through your PRD and defend your decisions.',
    available: true,
  },
  { id: 'bad-news', title: 'Bad News Delivery', blurb: 'Deliver a slip, a cut, or a reversal.', available: false },
  { id: 'scope-cut', title: 'Scope Cut Negotiation', blurb: 'Negotiate what ships and what waits.', available: false },
  { id: 'xfn-align', title: 'Cross-functional Alignment', blurb: 'Get design, eng, and GTM to one plan.', available: false },
  { id: 'sales-enablement', title: 'Sales Enablement', blurb: 'Bring sales along on a feature and its limits.', available: false },
  { id: 'client-demo', title: 'Big Client Demo', blurb: 'Present under pressure to a skeptical client.', available: false },
];

export function Home({ onPick }: { onPick: (categoryId: string) => void }) {
  return (
    <div className="screen">
      <h2>Choose a conversation to practice</h2>
      <p className="muted">Pick a scenario. You provide the context, then talk it through with an AI persona.</p>

      <div className="card-grid">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            className={`card ${c.available ? '' : 'card-disabled'}`}
            disabled={!c.available}
            onClick={() => c.available && onPick(c.id)}
          >
            <span className="card-title">{c.title}</span>
            <span className="card-blurb">{c.blurb}</span>
            {!c.available && <span className="badge">Coming soon</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
