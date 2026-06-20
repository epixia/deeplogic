// Agent tool catalogue — the tools an agent can be granted in the editor. These
// names must match the server's AGENT_ELIGIBLE_TOOLS (studio/assistant.ts). When
// an agent has no explicit selection (tools === null) the server applies
// AGENT_DEFAULT_TOOLS, which is mirrored here for the editor's default state.

export interface AgentTool {
  name: string
  label: string
  icon: string
  description: string
}

export const AGENT_TOOLS: AgentTool[] = [
  { name: 'web_research', label: 'Web research', icon: '🔍', description: 'Search the live web for company, competitor, market & financial info.' },
  { name: 'fetch_url', label: 'Read a web page', icon: '🌐', description: 'Fetch and read any public URL — homepage, /about, /investors.' },
  { name: 'wikipedia_lookup', label: 'Wikipedia lookup', icon: '📚', description: 'Pull reliable facts — public status, ticker, founding, HQ, revenue.' },
  { name: 'add_to_vault', label: 'Save to DataVault', icon: '💾', description: 'Write research & notes into the DataVault as reusable context.' },
  { name: 'add_connector', label: 'Add a connector', icon: '🔌', description: 'Register a queryable API/data source in the DataVault.' },
  { name: 'create_widget', label: 'Build a Block', icon: '📊', description: 'Create a dashboard Block — KPI, chart, table or news feed.' },
]

// Default tools applied when an agent has no explicit selection (mirrors server).
export const AGENT_DEFAULT_TOOLS: string[] = ['web_research', 'fetch_url', 'wikipedia_lookup', 'add_to_vault']
