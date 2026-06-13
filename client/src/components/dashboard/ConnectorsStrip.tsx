// Header connectors strip — shows each mapped connector as a chip with its
// kind, table count and live/syncing status. Styled after the landing page.

import type { Connector } from '../../types'

const KIND_LABEL: Record<Connector['kind'], string> = {
  powerbi: 'Power BI',
  snowflake: 'Snowflake',
  salesforce: 'Salesforce',
  hubspot: 'HubSpot',
  sqlserver: 'SQL Server',
  sheets: 'Google Sheets',
  sap: 'SAP',
  excel: 'Excel',
  rest: 'REST API',
}

export default function ConnectorsStrip({
  connectors,
}: {
  connectors: Connector[]
}) {
  if (!connectors.length) return null

  return (
    <div className="dl-connstrip">
      <div className="dl-connstrip__lbl">Connectors</div>
      <div className="dl-connstrip__chips">
        {connectors.map((c) => {
          const syncing = c.status === 'syncing'
          return (
            <span
              key={c.id}
              className="dl-chip"
              title={`${KIND_LABEL[c.kind]} · ${c.tables.length} table${
                c.tables.length === 1 ? '' : 's'
              } · ${c.status}`}
            >
              <span
                className={`dl-chip__dot${syncing ? ' is-syncing' : ''}`}
                aria-hidden
              />
              <span className="dl-chip__name">{c.name}</span>
              <span className="dl-chip__kind">{KIND_LABEL[c.kind]}</span>
              <span className="dl-chip__tables">{c.tables.length}t</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}
