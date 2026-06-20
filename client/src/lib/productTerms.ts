// Central product terminology for DeepLogic. Use these constants for any NEW
// user-facing copy so naming stays consistent as the product evolves.
//
// Product model:  Connectors → DataVault → Blocks → Signals → Agents
//
// NOTE: "Block" is the user-facing name for what the codebase still calls a
// "widget" internally (type Widget, /widgets routes, widget_* DB columns). We
// intentionally keep the internal names to avoid breaking saved data & APIs —
// only the displayed text changed. New surfaces should read from PRODUCT_TERMS.

export const PRODUCT_TERMS = {
  // Blocks (formerly "Widgets")
  block: 'Block',
  blocks: 'Blocks',
  addBlock: 'Add Block',
  createBlock: 'Create Block',
  newBlock: 'New Block',
  blockLibrary: 'Block Library',
  myBlocks: 'My Blocks',
  blockSettings: 'Block Settings',
  blockType: 'Block Type',
  blockTemplate: 'Block Template',
  featuredBlocks: 'Featured Blocks',
  connectedBlocks: 'Connected Blocks',
  aiBlocks: 'AI Blocks',
  dashboardBlocks: 'Dashboard Blocks',

  // Connectors
  connector: 'Connector',
  connectors: 'Connectors',
  connectorLibrary: 'Connector Library',

  // Pillars
  dataVault: 'DataVault',
  signals: 'Signals',
  agents: 'Agents',
  reports: 'Reports',
  dashboards: 'Dashboards',
} as const

// Product copy — single source of truth for the headline marketing/UX strings.
export const PRODUCT_COPY = {
  tagline:
    'Connect your business tools to DeepLogic and turn scattered data into Blocks, Signals, Reports, and autonomous Agent workflows.',
  connectorLibrary:
    'Use Connectors to bring data from platforms like HubSpot, Salesforce, QuickBooks, Shopify, Stripe, Google Analytics, and more into your DeepLogic DataVault.',
  blocks:
    'Blocks are modular intelligence components that monitor KPIs, track competitors, summarize news, display live feeds, and trigger agent actions.',
} as const

export type ProductTermKey = keyof typeof PRODUCT_TERMS
