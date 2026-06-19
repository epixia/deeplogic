import { Panel, Button } from '@deeplogic/ui'

export function EmptyState() {
  return (
    <Panel title="No competitors yet">
      Add a competitor and we'll track their positioning, news and key facts.
    </Panel>
  )
}

export function WithActions() {
  return (
    <Panel
      title="Your workspace is ready"
      actions={<><Button variant="primary">Enter DeepLogic →</Button><Button variant="ghost">Add data</Button></>}
    >
      We've learned your business and seeded your data vault.
    </Panel>
  )
}
