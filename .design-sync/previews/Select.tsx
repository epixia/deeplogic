import { Select } from '@deeplogic/ui'

export function WithLabel() {
  return (
    <Select label="Region" defaultValue="us-east" style={{ minWidth: 240 }}>
      <option value="us-east">US East</option>
      <option value="us-west">US West</option>
      <option value="eu-west">EU West</option>
    </Select>
  )
}

export function Bare() {
  return (
    <Select defaultValue="medium" style={{ minWidth: 200 }}>
      <option value="small">Small VM</option>
      <option value="medium">Medium VM</option>
      <option value="large">Large VM</option>
    </Select>
  )
}
