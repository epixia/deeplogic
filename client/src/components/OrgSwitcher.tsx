// OrgSwitcher — a compact dropdown of the user's orgs. Switching navigates to
// the selected org's ingest page. Reads the active orgId from the URL params.

import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import './org-switcher.css'

export default function OrgSwitcher() {
  const { orgs } = useAuth()
  const { orgId } = useParams<{ orgId: string }>()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  if (orgs.length === 0) return null

  const active = orgs.find((o) => o.id === orgId) ?? orgs[0]

  function select(id: string) {
    setOpen(false)
    if (id !== orgId) navigate(`/app/${id}/ingest`)
  }

  return (
    <div className="dl-orgsw" ref={ref}>
      <button
        type="button"
        className="dl-orgsw__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="dl-orgsw__avatar">
          {active.name.charAt(0).toUpperCase()}
        </span>
        <span className="dl-orgsw__name">{active.name}</span>
        <span className="dl-orgsw__chev" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <ul className="dl-orgsw__menu" role="listbox">
          {orgs.map((o) => (
            <li key={o.id} role="option" aria-selected={o.id === active.id}>
              <button
                type="button"
                className={`dl-orgsw__item${
                  o.id === active.id ? ' is-active' : ''
                }`}
                onClick={() => select(o.id)}
              >
                <span className="dl-orgsw__avatar sm">
                  {o.name.charAt(0).toUpperCase()}
                </span>
                <span className="dl-orgsw__itemtext">
                  <span className="dl-orgsw__itemname">{o.name}</span>
                  <span className="dl-orgsw__itemrole">{o.role}</span>
                </span>
                {o.id === active.id && (
                  <span className="dl-orgsw__check" aria-hidden>
                    ✓
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
