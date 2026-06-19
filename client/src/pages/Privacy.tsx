// Privacy policy — public page linked from the footer.
import Footer from '../components/Footer'
import './legal.css'

export default function Privacy() {
  return (
    <>
      <main className="dl-legal">
        <h1>Privacy Policy</h1>
        <p className="dl-legal-updated">Last updated: {new Date().getFullYear()}</p>

        <p>
          DeepLogic helps you turn your business data and reports into AI agents. This policy explains
          what we collect, how we use it, and the choices you have. We keep it plain-language on purpose.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li><strong>Account data</strong> — your name and email when you create a workspace.</li>
          <li><strong>Workspace content</strong> — the websites, documents, Power BI exports, notes and connectors you add to your Data Vault.</li>
          <li><strong>Usage data</strong> — basic logs needed to operate and secure the service.</li>
        </ul>

        <h2>How we use it</h2>
        <ul>
          <li>To provide the product — analysing your content to build dashboards, agents and insights you ask for.</li>
          <li>To send service communications (e.g. a link to set your password).</li>
          <li>To keep the platform secure and reliable.</li>
        </ul>
        <p>We do not sell your data. Your workspace content is used to serve <em>you</em>, not to train shared models.</p>

        <h2 id="security">Security</h2>
        <p>
          Data is isolated per workspace with row-level security, encrypted in transit, and accessed
          under least-privilege controls. AI provider keys are stored server-side and never exposed to
          the browser. You control which data enters your Data Vault, and you can remove it at any time.
        </p>

        <h2>Your choices</h2>
        <ul>
          <li>Access, export or delete your workspace content from within the app.</li>
          <li>Close your account and request deletion by contacting us.</li>
        </ul>

        <h2>Contact</h2>
        <p>Questions about privacy? Email <a href="mailto:privacy@deeplogic.app">privacy@deeplogic.app</a>.</p>

        <p className="dl-legal-note">
          This is a plain-language summary provided for transparency and is not a substitute for legal
          advice. For the definitive policy or a Data Processing Agreement, contact us.
        </p>
      </main>
      <Footer />
    </>
  )
}
