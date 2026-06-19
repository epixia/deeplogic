// Site footer for the public marketing pages — brand, nav, legal & support.

import { Link } from 'react-router-dom'
import Logo from './Logo'
import './footer.css'

const YEAR = new Date().getFullYear()

export default function Footer() {
  return (
    <footer className="dl-footer">
      <div className="dl-footer-inner">
        <div className="dl-footer-brand">
          <div className="dl-footer-mark">
            <Logo size={30} title="DeepLogic" />
            <span className="dl-footer-name">DEEPLOGIC</span>
          </div>
          <p className="dl-footer-tag">Turn your reports and data into AI agents working for you 24/7.</p>
        </div>

        <nav className="dl-footer-cols" aria-label="Footer">
          <div className="dl-footer-col">
            <h4>Product</h4>
            <Link to="/onboarding">Get started</Link>
            <Link to="/pricing">Pricing</Link>
            <Link to="/login">Sign in</Link>
          </div>
          <div className="dl-footer-col">
            <h4>Support</h4>
            <a href="mailto:support@deeplogic.app">Contact support</a>
            <a href="mailto:hello@deeplogic.app">Talk to us</a>
            <Link to="/pricing#faq">FAQ</Link>
          </div>
          <div className="dl-footer-col">
            <h4>Legal</h4>
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms of Service</Link>
            <Link to="/privacy#security">Security</Link>
          </div>
        </nav>
      </div>

      <div className="dl-footer-bar">
        <span>© {YEAR} DeepLogic. All rights reserved.</span>
        <span className="dl-footer-partners">Microsoft &amp; NVIDIA partner</span>
      </div>
    </footer>
  )
}
