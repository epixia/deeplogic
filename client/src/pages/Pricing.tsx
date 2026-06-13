// Pricing — public page. Monthly/Yearly toggle, four tiers, a usage/token
// (DeepLogic Credits) explainer, and a short FAQ. CTAs route to sign-up.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import Logo from '../components/Logo'
import './pricing.css'

type Cycle = 'monthly' | 'yearly'

interface Tier {
  name: string
  tagline: string
  monthly: number | null // null = custom
  yearly: number | null // per-month price when billed yearly
  unit: string
  cta: { label: string; to: string }
  highlight?: boolean
  tokens: string
  features: string[]
}

const TIERS: Tier[] = [
  {
    name: 'Free',
    tagline: 'Kick the tires on your own data.',
    monthly: 0,
    yearly: 0,
    unit: 'forever',
    cta: { label: 'Start free', to: '/signup' },
    tokens: '100K AI tokens / mo',
    features: [
      '1 workspace · up to 2 members',
      '3 reports & projects',
      'Sample data + full public demo',
      'Template-mode report generation',
      'Anomaly detection & Mission Control',
      'Community support',
    ],
  },
  {
    name: 'Team',
    tagline: 'AI report-building for a whole team.',
    monthly: 39,
    yearly: 32,
    unit: '/user / mo',
    cta: { label: 'Start 14-day trial', to: '/signup' },
    highlight: true,
    tokens: '2M AI tokens / user / mo',
    features: [
      'Unlimited reports & projects',
      'Full Claude-powered vibecoding',
      'Connect data sources + model grounding',
      'Context Library (docs, HTML, MCP, notes)',
      'Org RBAC (owner / admin / member)',
      'Share & publish reports',
      'Email support',
    ],
  },
  {
    name: 'Business',
    tagline: 'Scale, governance, and connectors.',
    monthly: 79,
    yearly: 65,
    unit: '/user / mo',
    cta: { label: 'Start 14-day trial', to: '/signup' },
    tokens: '10M AI tokens / user / mo',
    features: [
      'Everything in Team',
      'MCP connectors & live data tools',
      'Advanced audit log & retention',
      'SSO-ready · priority support',
      'Usage analytics & cost controls',
      'Bring-your-own model key (BYOK)',
    ],
  },
  {
    name: 'Enterprise',
    tagline: 'Security, self-host, and scale.',
    monthly: null,
    yearly: null,
    unit: '',
    cta: { label: 'Talk to sales', to: '/signup' },
    tokens: 'Custom / unlimited tokens',
    features: [
      'Everything in Business',
      'Self-host / VPC deployment',
      'SSO / SAML & SCIM provisioning',
      'SLA, security review & DPA',
      'Dedicated success manager',
    ],
  },
]

function priceLabel(t: Tier, cycle: Cycle): { big: string; small: string } {
  if (t.monthly === null) return { big: 'Custom', small: 'tailored to you' }
  const v = cycle === 'monthly' ? t.monthly : t.yearly
  if (v === 0) return { big: '$0', small: t.unit }
  return { big: `$${v}`, small: `${t.unit}${cycle === 'yearly' ? ' · billed yearly' : ''}` }
}

export default function Pricing() {
  const [cycle, setCycle] = useState<Cycle>('yearly')

  return (
    <main className="wrap dl-pricing">
      <header className="pr-hero">
        <span className="pill">
          <span className="dot" /> Simple, usage-aware pricing
        </span>
        <h1 className="pr-h1">
          Plans that scale from a first report to a{' '}
          <span className="grad-text">company-wide control room</span>.
        </h1>
        <p className="pr-sub">
          Every plan includes the agentic analytics engine. AI report generation
          is metered in tokens — generous monthly allotments, transparent overage.
        </p>

        <div className="pr-toggle" role="group" aria-label="Billing cycle">
          <button
            className={`pr-toggle-btn ${cycle === 'monthly' ? 'is-on' : ''}`}
            onClick={() => setCycle('monthly')}
            type="button"
          >
            Monthly
          </button>
          <button
            className={`pr-toggle-btn ${cycle === 'yearly' ? 'is-on' : ''}`}
            onClick={() => setCycle('yearly')}
            type="button"
          >
            Yearly <span className="pr-save">save ~18%</span>
          </button>
        </div>
      </header>

      <section className="pr-grid">
        {TIERS.map((t) => {
          const p = priceLabel(t, cycle)
          return (
            <div
              key={t.name}
              className={`pr-card rounded-card ${t.highlight ? 'is-highlight' : ''}`}
            >
              {t.highlight && <div className="pr-badge">Most popular</div>}
              <div className="pr-card-head">
                <h3>{t.name}</h3>
                <p className="pr-tagline">{t.tagline}</p>
              </div>
              <div className="pr-price">
                <span className="pr-price-big grad-text">{p.big}</span>
                <span className="pr-price-small">{p.small}</span>
              </div>
              <div className="pr-tokens">{t.tokens}</div>
              <Link
                to={t.cta.to}
                className={`btn ${t.highlight ? 'btn-primary' : 'btn-ghost'} pr-cta`}
              >
                {t.cta.label}
              </Link>
              <ul className="pr-features">
                {t.features.map((f) => (
                  <li key={f}>
                    <span className="pr-check">◆</span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </section>

      {/* usage / token model */}
      <section className="pr-usage rounded-card">
        <div className="pr-usage-copy">
          <span className="eyebrow">How AI usage works</span>
          <h2>Pay for thinking, not for dashboards.</h2>
          <p>
            Connecting data, dashboards, Mission Control and anomaly detection are
            <strong> always included</strong>. Only AI report generation in Reports
            consumes <strong>AI tokens</strong> (we pass through Claude usage with
            a thin margin). Each plan includes a monthly pool; need more? Overage
            is billed at a flat rate — no surprise tiers.
          </p>
          <div className="pr-usage-cta">
            <Link to="/signup" className="btn btn-primary">
              Get started free →
            </Link>
            <Link to="/" className="btn btn-ghost">
              See the demo
            </Link>
          </div>
        </div>
        <div className="pr-usage-stats">
          <div className="pr-stat">
            <div className="pr-stat-v grad-text">$20</div>
            <div className="pr-stat-k">per extra 1M tokens</div>
          </div>
          <div className="pr-stat">
            <div className="pr-stat-v grad-text">~8–15</div>
            <div className="pr-stat-k">reports per 1M tokens*</div>
          </div>
          <div className="pr-stat">
            <div className="pr-stat-v grad-text">BYOK</div>
            <div className="pr-stat-k">bring your own model key</div>
          </div>
          <p className="pr-stat-note">
            *Typical one-page report. Iterations and large grounding data use more.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="pr-faq">
        <span className="eyebrow">FAQ</span>
        <h2>Questions, answered.</h2>
        <div className="pr-faq-grid">
          {[
            [
              'What counts as an AI token?',
              'Tokens are consumed only when Reports generates or edits a report with Claude. Analytics, dashboards, and Mission Control never consume tokens.',
            ],
            [
              'Can I run it without paying for AI?',
              'Yes — Free and any plan can run in template mode, or you can bring your own provider key (Claude, OpenAI, or OpenRouter) so generation bills to your own account.',
            ],
            [
              'What happens if I exceed my token pool?',
              'Generation keeps working; overage is billed at $20 per additional 1M tokens. You can set hard caps per workspace on Business+.',
            ],
            [
              'Is my data used to train models?',
              'Never. Your reports and data stay in your workspace and are not used to train shared models.',
            ],
            [
              'Can I switch plans or cancel anytime?',
              'Yes. Upgrade, downgrade, or cancel anytime; yearly plans are prorated.',
            ],
            [
              'Do you offer self-hosting?',
              'Enterprise supports self-host / VPC deployment alongside your own Supabase and model keys.',
            ],
          ].map(([q, a]) => (
            <div key={q} className="pr-faq-item rounded-card">
              <h3>{q}</h3>
              <p>{a}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="pr-final rounded-card">
        <Logo size={40} title="DeepLogic" />
        <h2>From reports to a control room that thinks.</h2>
        <p>Start free in minutes — no credit card required.</p>
        <Link to="/signup" className="btn btn-primary">
          Create your workspace →
        </Link>
      </section>
    </main>
  )
}
