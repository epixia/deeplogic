// Terms of service — public page linked from the footer.
import Footer from '../components/Footer'
import './legal.css'

export default function Terms() {
  return (
    <>
      <main className="dl-legal">
        <h1>Terms of Service</h1>
        <p className="dl-legal-updated">Last updated: {new Date().getFullYear()}</p>

        <p>By using DeepLogic you agree to these terms. Please read them — they're short.</p>

        <h2>Your account</h2>
        <p>
          You're responsible for your account and for the activity in your workspace. Keep your
          credentials safe and tell us promptly of any unauthorised use.
        </p>

        <h2>Acceptable use</h2>
        <ul>
          <li>Only upload data you have the right to use.</li>
          <li>Don't use the service to break the law, infringe others' rights, or attempt to disrupt the platform.</li>
          <li>Automated agents you deploy must operate within these terms and the policies of any connected service.</li>
        </ul>

        <h2>Your content</h2>
        <p>
          You own your workspace content. You grant us the permissions needed to process it so we can
          provide the features you request (analysis, dashboards, agents). See our{' '}
          <a href="/privacy">Privacy Policy</a> for how it's handled.
        </p>

        <h2>Third-party services</h2>
        <p>
          DeepLogic connects to services you choose (AI providers, data connectors, agent runtimes).
          Your use of those is also governed by their terms, and usage may incur their fees.
        </p>

        <h2>Availability &amp; liability</h2>
        <p>
          The service is provided “as is”. We work hard to keep it reliable but don't guarantee
          uninterrupted availability, and our liability is limited to the maximum extent permitted by law.
        </p>

        <h2>Contact</h2>
        <p>Questions about these terms? Email <a href="mailto:hello@deeplogic.app">hello@deeplogic.app</a>.</p>

        <p className="dl-legal-note">
          This is a plain-language summary provided for transparency and is not a substitute for legal advice.
        </p>
      </main>
      <Footer />
    </>
  )
}
