// Connector Library data model for DeepLogic.
//
// Product model:  Connectors → DataVault → Blocks → Signals → Agents
//
// Connectors bring data from external platforms into the DataVault; each
// connector recommends the Blocks (intelligence components) it can power.
// This is front-end definition data — connecting a connector stores credentials
// as a Data Vault connector (see Vault / IntegrationsCatalog), so nothing here
// changes existing storage.

export type ConnectorCategory =
  | 'crm'
  | 'accounting'
  | 'ecommerce'
  | 'payments'
  | 'analytics'
  | 'marketing'
  | 'support'
  | 'productivity'
  | 'files'
  | 'custom'

export type ConnectorAuthType =
  | 'oauth2'
  | 'api_key'
  | 'webhook'
  | 'database'
  | 'file_upload'

export interface Connector {
  id: string
  name: string
  slug: string
  category: ConnectorCategory
  authType: ConnectorAuthType
  icon: string // emoji fallback shown when no logoUrl
  logoUrl?: string
  description: string
  supportedEntities: string[]
  recommendedBlocks: string[]
  isNative: boolean
  isActive: boolean // false → "Coming soon"
  docsUrl?: string // provider API documentation
}

export const CONNECTOR_CATEGORIES: { id: ConnectorCategory; label: string }[] = [
  { id: 'crm', label: 'CRM' },
  { id: 'accounting', label: 'Accounting' },
  { id: 'ecommerce', label: 'Ecommerce' },
  { id: 'payments', label: 'Payments' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'support', label: 'Support' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'files', label: 'Files' },
  { id: 'custom', label: 'Custom' },
]

export const CONNECTOR_AUTH_LABEL: Record<ConnectorAuthType, string> = {
  oauth2: 'OAuth2',
  api_key: 'API Key',
  webhook: 'Webhook',
  database: 'Database',
  file_upload: 'File Upload',
}

// ---------------------------------------------------------------------------
// Block templates — the kinds of intelligence components a Block can be.
// ---------------------------------------------------------------------------

export type BlockTemplateKind =
  | 'kpi'
  | 'chart'
  | 'table'
  | 'live_feed'
  | 'news'
  | 'competitor'
  | 'signal'
  | 'insight'
  | 'action'
  | 'source'
  | 'knowledge'

export interface BlockTemplate {
  kind: BlockTemplateKind
  name: string
  icon: string
  description: string
}

export const BLOCK_TEMPLATES: BlockTemplate[] = [
  { kind: 'kpi', name: 'KPI Block', icon: '📊', description: 'A headline metric with trend and target.' },
  { kind: 'chart', name: 'Chart Block', icon: '📈', description: 'Bar, line, or pie visualization of your data.' },
  { kind: 'table', name: 'Table Block', icon: '📋', description: 'Ranked rows — top customers, transactions, products.' },
  { kind: 'live_feed', name: 'Live Feed Block', icon: '📹', description: 'A live feed — camera, status, or streaming source.' },
  { kind: 'news', name: 'News Block', icon: '📰', description: 'Summarized headlines relevant to your business.' },
  { kind: 'competitor', name: 'Competitor Block', icon: '⚔️', description: 'Track a competitor’s SEO, traffic, and moves.' },
  { kind: 'signal', name: 'Signal Block', icon: '🔔', description: 'Surface alerts, anomalies, risks, and opportunities.' },
  { kind: 'insight', name: 'Insight Block', icon: '💡', description: 'An AI narrative summary of what matters now.' },
  { kind: 'action', name: 'Action Block', icon: '⚡', description: 'Trigger an autonomous or semi-autonomous Agent action.' },
  { kind: 'source', name: 'Source Block', icon: '🔗', description: 'A connected data source feeding your workspace.' },
  { kind: 'knowledge', name: 'Knowledge Block', icon: '📚', description: 'Reference docs and context that ground answers.' },
]

// ---------------------------------------------------------------------------
// Connector definitions (initial set).
// ---------------------------------------------------------------------------

export const CONNECTORS: Connector[] = [
  {
    id: 'hubspot',
    name: 'HubSpot',
    slug: 'hubspot',
    category: 'crm',
    authType: 'oauth2',
    icon: '🟧',
    description: 'Contacts, deals, pipeline, and marketing activity from your HubSpot CRM.',
    supportedEntities: ['Contacts', 'Companies', 'Deals', 'Pipelines', 'Tickets', 'Marketing emails'],
    recommendedBlocks: ['Sales Pipeline Block', 'Lead Velocity Block', 'Deal Risk Block', 'Follow-up Signal Block', 'Sales Rep Performance Block'],
    isNative: true,
    isActive: false,
  },
  {
    id: 'odoo',
    name: 'Odoo',
    slug: 'odoo',
    category: 'crm',
    authType: 'api_key',
    icon: '🟣',
    description:
      'Two-way sync with Odoo CRM & ERP — leads, customers, suppliers, and the competitors in your deals. DeepLogic enriches each record with live external intelligence and writes the insight back into Odoo.',
    supportedEntities: ['Leads (crm.lead)', 'Customers (res.partner)', 'Suppliers (res.partner)', 'Sales Orders', 'Purchase Orders', 'Products'],
    recommendedBlocks: ['Lead Score Block', 'Sales Pipeline Block', 'Supplier Risk Signal Block', 'Win/Loss Block', 'Competitor Block'],
    isNative: true,
    isActive: false,
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    slug: 'salesforce',
    category: 'crm',
    authType: 'oauth2',
    icon: '☁️',
    description: 'Leads, opportunities, accounts, and pipeline from your Salesforce org.',
    supportedEntities: ['Leads', 'Opportunities', 'Accounts', 'Contacts', 'Cases'],
    recommendedBlocks: ['Sales Pipeline Block', 'Win Rate Block', 'Deal Risk Block', 'Forecast Block', 'Sales Rep Performance Block'],
    isNative: true,
    isActive: false,
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks',
    slug: 'quickbooks',
    category: 'accounting',
    authType: 'oauth2',
    icon: '📗',
    description: 'Invoices, expenses, P&L, and cash flow from QuickBooks Online.',
    supportedEntities: ['Invoices', 'Bills', 'Expenses', 'Customers', 'Accounts', 'Payments'],
    recommendedBlocks: ['Cash Flow Block', 'Revenue Block', 'Expense Block', 'Unpaid Invoice Block', 'Customer Profitability Block'],
    isNative: true,
    isActive: false,
  },
  {
    id: 'shopify',
    name: 'Shopify',
    slug: 'shopify',
    category: 'ecommerce',
    authType: 'oauth2',
    icon: '🛍️',
    description: 'Orders, products, customers, and storefront sales from Shopify.',
    supportedEntities: ['Orders', 'Products', 'Customers', 'Inventory', 'Checkouts'],
    recommendedBlocks: ['Sales Block', 'Product Performance Block', 'Inventory Risk Block', 'Customer Repeat Rate Block', 'Abandoned Cart Signal Block'],
    isNative: true,
    isActive: false,
  },
  {
    id: 'stripe',
    name: 'Stripe',
    slug: 'stripe',
    category: 'payments',
    authType: 'api_key',
    icon: '💳',
    description: 'Payments, subscriptions, MRR, and churn from Stripe.',
    supportedEntities: ['Charges', 'Subscriptions', 'Customers', 'Invoices', 'Payouts'],
    recommendedBlocks: ['MRR Block', 'Churn Signal Block', 'Revenue Block', 'Failed Payment Signal Block', 'Customer LTV Block'],
    isNative: true,
    isActive: false,
  },
  {
    id: 'google-analytics',
    name: 'Google Analytics',
    slug: 'google-analytics',
    category: 'analytics',
    authType: 'oauth2',
    icon: '📈',
    description: 'Traffic, sessions, conversions, and acquisition (GA4).',
    supportedEntities: ['Sessions', 'Users', 'Events', 'Conversions', 'Channels'],
    recommendedBlocks: ['Traffic Block', 'Conversion Block', 'Acquisition Block', 'Traffic Anomaly Signal Block'],
    isNative: true,
    isActive: false,
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    slug: 'google-sheets',
    category: 'files',
    authType: 'oauth2',
    icon: '📊',
    description: 'Pull data straight from spreadsheets into the DataVault.',
    supportedEntities: ['Sheets', 'Ranges', 'Rows'],
    recommendedBlocks: ['KPI Block', 'Chart Block', 'Table Block'],
    isNative: true,
    isActive: false,
  },
  {
    id: 'csv-excel',
    name: 'CSV / Excel Upload',
    slug: 'csv-excel',
    category: 'files',
    authType: 'file_upload',
    icon: '⤓',
    description: 'Upload a CSV or Excel file and turn it into Blocks instantly.',
    supportedEntities: ['Tables', 'Columns', 'Rows'],
    recommendedBlocks: ['KPI Block', 'Chart Block', 'Table Block', 'Insight Block'],
    isNative: true,
    isActive: true,
  },
  {
    id: 'webhook',
    name: 'Webhook',
    slug: 'webhook',
    category: 'custom',
    authType: 'webhook',
    icon: '🪝',
    description: 'Let external apps, Zapier, or Make push data into DeepLogic in real time.',
    supportedEntities: ['Events', 'Payloads'],
    recommendedBlocks: ['Live Feed Block', 'Signal Block', 'Action Block', 'KPI Block'],
    isNative: true,
    isActive: true,
  },
  {
    id: 'custom-api',
    name: 'Custom API Connector',
    slug: 'custom-api',
    category: 'custom',
    authType: 'api_key',
    icon: '⚡',
    description: 'Connect any REST API with a base URL and an API key or bearer token.',
    supportedEntities: ['Endpoints', 'Records'],
    recommendedBlocks: ['KPI Block', 'Table Block', 'Chart Block', 'Source Block'],
    isNative: true,
    isActive: true,
  },
  {
    id: 'powerbi',
    name: 'Power BI',
    slug: 'powerbi',
    category: 'analytics',
    authType: 'oauth2',
    icon: '▦',
    description: 'Import datasets, measures, and KPIs from your Power BI workspace.',
    supportedEntities: ['Datasets', 'Tables', 'Measures', 'Reports'],
    recommendedBlocks: ['KPI Block', 'Chart Block', 'Table Block', 'Insight Block'],
    isNative: true,
    isActive: true,
  },
]

// Official API documentation per connector (shown as a "Docs" button). First-
// party connectors (CSV/Excel upload) have no external docs and are omitted.
const CONNECTOR_DOCS: Record<string, string> = {
  hubspot: 'https://developers.hubspot.com/docs/api/overview',
  odoo: 'https://www.odoo.com/documentation/17.0/developer/reference/external_api.html',
  salesforce: 'https://developer.salesforce.com/docs/apis',
  quickbooks: 'https://developer.intuit.com/app/developer/qbo/docs/get-started',
  shopify: 'https://shopify.dev/docs/api',
  stripe: 'https://stripe.com/docs/api',
  'google-analytics': 'https://developers.google.com/analytics/devguides/reporting/data/v1',
  'google-sheets': 'https://developers.google.com/sheets/api/reference/rest',
  webhook: 'https://en.wikipedia.org/wiki/Webhook',
  'custom-api': 'https://developer.mozilla.org/en-US/docs/Web/HTTP',
  powerbi: 'https://learn.microsoft.com/en-us/rest/api/power-bi/',
}
for (const c of CONNECTORS) c.docsUrl = CONNECTOR_DOCS[c.id]

export const connectorBySlug = (slug: string): Connector | undefined =>
  CONNECTORS.find((c) => c.slug === slug)
