import { Tabs } from '@deeplogic/ui'

const items = [
  { id: 'mine', label: 'Mine' },
  { id: 'shared', label: 'Shared' },
  { id: 'context', label: 'Context' },
]

export function Default() {
  return <Tabs items={items} value="mine" onChange={() => {}} />
}

export function SecondActive() {
  return <Tabs items={items} value="shared" onChange={() => {}} />
}
