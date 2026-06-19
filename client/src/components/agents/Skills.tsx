// Skills — the capability catalogue for the Agents page. These are the real
// tools the DeepLogic assistant and agents can draw on (mirrors the server-side
// ASSISTANT_TOOLS + memory recall). Presentational: it surfaces what agents can
// do, grouped by category, so users understand the platform's reach.

import './skills.css'

type Category = 'Research' | 'Knowledge' | 'Build' | 'Autonomy'

interface Skill {
  icon: string
  name: string
  category: Category
  blurb: string
}

const SKILLS: Skill[] = [
  { icon: '🔍', name: 'Web research', category: 'Research', blurb: 'Search the live web for company, competitor, market and financial information.' },
  { icon: '📚', name: 'Wikipedia lookup', category: 'Research', blurb: 'Pull reliable facts — public status, ticker, founding, HQ, revenue, headcount.' },
  { icon: '🌐', name: 'Read a web page', category: 'Research', blurb: 'Fetch and read any public URL — a homepage, /about or /investors page.' },
  { icon: '🛍', name: 'Company & product analysis', category: 'Research', blurb: 'Analyse a website to extract the business profile and the products it sells.' },
  { icon: '🔭', name: 'Competitor discovery', category: 'Research', blurb: 'Identify and profile a company’s most relevant real competitors.' },
  { icon: '🕸', name: 'Memory recall', category: 'Knowledge', blurb: 'Recall currently-valid facts from the workspace knowledge graph to ground answers.' },
  { icon: '💾', name: 'Save to Data Vault', category: 'Knowledge', blurb: 'Write research and notes into the vault as structured, reusable context.' },
  { icon: '📊', name: 'Build a widget', category: 'Build', blurb: 'Create a dashboard widget — KPI, chart, table or news feed — from a prompt.' },
  { icon: '🤖', name: 'Create an agent', category: 'Build', blurb: 'Spin up a scheduled AI agent with a tailored system prompt.' },
  { icon: '🚀', name: 'Deploy a VM agent', category: 'Autonomy', blurb: 'Provision a real Orgo virtual computer and run an autonomous mission (Hermes / OpenClaw).' },
]

const CAT_TONE: Record<Category, string> = {
  Research: 'sk-cat--research', Knowledge: 'sk-cat--knowledge', Build: 'sk-cat--build', Autonomy: 'sk-cat--autonomy',
}

export default function Skills() {
  return (
    <div className="sk-wrap">
      <div className="sk-head">
        <h2>Skills</h2>
        <span className="sk-sub">The capabilities your agents and the ✦ assistant can use — available across this workspace.</span>
      </div>
      <div className="sk-grid">
        {SKILLS.map((s) => (
          <div className="sk-card" key={s.name}>
            <div className="sk-card-top">
              <span className="sk-ic">{s.icon}</span>
              <span className={`sk-cat ${CAT_TONE[s.category]}`}>{s.category}</span>
            </div>
            <div className="sk-name">{s.name}</div>
            <p className="sk-blurb">{s.blurb}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
