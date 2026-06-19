import { Modal, Button } from '@deeplogic/ui'

export function Confirm() {
  return (
    <Modal
      open
      onClose={() => {}}
      title="Deploy to a VM"
      description="Provisions a dedicated Orgo computer and runs the mission on it."
      actions={<><Button variant="ghost">Cancel</Button><Button variant="primary">🚀 Deploy</Button></>}
    >
      <p style={{ fontSize: 13.5, color: 'var(--mut)', margin: 0 }}>
        Hermes will reach out to your dispensary buyers and report back here.
      </p>
    </Modal>
  )
}
