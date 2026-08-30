import { Link } from 'react-router-dom'
import { supabase, isConfigured } from '../lib/supabase.js'
import { useQuery } from '../hooks/useQuery.js'
import { Spinner, ErrorBanner } from '../components/ui.jsx'
import { fmtDate, isExpired, daysUntil } from '../lib/format.js'

async function loadDashboard() {
  const counts = {}
  for (const t of ['clients', 'audits', 'generated_documents', 'evidence_documents', 'safety_files']) {
    const { count } = await supabase.from(t).select('*', { count: 'exact', head: true })
    counts[t] = count ?? 0
  }
  const { data: openAudits } = await supabase
    .from('audits').select('id, audit_date, overall_score, clients(company_name), checklists(name)')
    .eq('status', 'in_progress').order('audit_date', { ascending: false }).limit(8)
  const { data: pendingEvidence } = await supabase
    .from('evidence_documents').select('id, document_ref, title, issuing_body, client_id, clients(company_name)')
    .eq('status', 'pending_review').limit(10)
  const { data: expiring } = await supabase
    .from('evidence_documents').select('id, document_ref, title, expiry_date, clients(company_name)')
    .eq('status', 'accepted').not('expiry_date', 'is', null).order('expiry_date').limit(20)
  return { counts, openAudits: openAudits ?? [], pendingEvidence: pendingEvidence ?? [], expiring: expiring ?? [] }
}

export default function Dashboard() {
  const { data, loading, error } = useQuery(loadDashboard, [])

  if (!isConfigured) {
    return (
      <>
        <header><h1>Dashboard</h1></header>
        <div className="notice">
          Connect Supabase to get started — see <span className="mono">README.md</span>. Set{' '}
          <span className="mono">VITE_SUPABASE_URL</span> and <span className="mono">VITE_SUPABASE_ANON_KEY</span>,
          run the migrations in <span className="mono">supabase/migrations</span>, then reload.
        </div>
      </>
    )
  }
  if (loading) return <Spinner />
  if (error) return <ErrorBanner error={error} />

  const c = data.counts
  const soon = data.expiring.filter((e) => {
    const d = daysUntil(e.expiry_date)
    return d != null && d <= 60
  })

  return (
    <>
      <header><h1>Dashboard</h1></header>

      <div className="grid-cards" style={{ marginBottom: '1.5rem' }}>
        <Stat n={c.clients} l="Clients" to="/clients" />
        <Stat n={c.audits} l="Audits" to="/audits" />
        <Stat n={c.generated_documents} l="Generated documents" to="/register" />
        <Stat n={c.evidence_documents} l="Evidence documents" to="/register" />
        <Stat n={c.safety_files} l="Assembled safety files" to="/assembly" />
      </div>

      <div className="panel">
        <div className="panel-title"><h2>Audits in progress</h2><Link to="/audits">All audits →</Link></div>
        {data.openAudits.length === 0 ? <div className="muted">Nothing in progress.</div> : (
          <table className="data">
            <thead><tr><th>Client</th><th>Checklist</th><th>Date</th><th>Score</th><th /></tr></thead>
            <tbody>
              {data.openAudits.map((a) => (
                <tr key={a.id}>
                  <td>{a.clients?.company_name}</td>
                  <td>{a.checklists?.name}</td>
                  <td>{fmtDate(a.audit_date)}</td>
                  <td>{a.overall_score == null ? '—' : `${a.overall_score}%`}</td>
                  <td><Link to={`/audits/${a.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <div className="panel-title"><h2>Evidence awaiting review</h2></div>
        {data.pendingEvidence.length === 0 ? <div className="muted">Nothing pending.</div> : (
          <table className="data">
            <thead><tr><th>Ref</th><th>Document</th><th>Client</th><th>Issuing body</th></tr></thead>
            <tbody>
              {data.pendingEvidence.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{e.document_ref}</td>
                  <td>{e.title || '—'}</td>
                  <td>{e.clients?.company_name}</td>
                  <td>{e.issuing_body || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <div className="panel-title"><h2>Evidence expiring within 60 days</h2></div>
        {soon.length === 0 ? <div className="muted">Nothing lapsing soon.</div> : (
          <table className="data">
            <thead><tr><th>Ref</th><th>Document</th><th>Client</th><th>Expiry</th></tr></thead>
            <tbody>
              {soon.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{e.document_ref}</td>
                  <td>{e.title || '—'}</td>
                  <td>{e.clients?.company_name}</td>
                  <td>
                    <span className={`pill ${isExpired(e.expiry_date) ? 'risk-extreme' : 'risk-medium'}`}>
                      {fmtDate(e.expiry_date)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

function Stat({ n, l, to }) {
  return (
    <Link to={to} className="stat" style={{ textDecoration: 'none' }}>
      <div className="n">{n}</div>
      <div className="l">{l}</div>
    </Link>
  )
}
