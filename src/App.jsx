import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider.jsx'
import LoginPage from './auth/LoginPage.jsx'
import Layout from './components/Layout.jsx'
import { Spinner } from './components/ui.jsx'

import Dashboard from './pages/Dashboard.jsx'
import ClientsPage from './pages/clients/ClientsPage.jsx'
import ClientDetailPage from './pages/clients/ClientDetailPage.jsx'
import SectorsPage from './pages/sectors/SectorsPage.jsx'
import ChecklistEditorPage from './pages/sectors/ChecklistEditorPage.jsx'
import LibraryPage from './pages/library/LibraryPage.jsx'
import DocumentRegisterPage from './pages/register/DocumentRegisterPage.jsx'

// Heavy pages (docx / pdf-lib / pdfjs) are code-split so login + dashboard load fast.
const DocumentBuilderPage = lazy(() => import('./pages/documents/DocumentBuilderPage.jsx'))
const AuditListPage = lazy(() => import('./pages/audits/AuditListPage.jsx'))
const AuditWorkspacePage = lazy(() => import('./pages/audits/AuditWorkspacePage.jsx'))
const FinalAssemblyPage = lazy(() => import('./pages/assembly/FinalAssemblyPage.jsx'))

export default function App() {
  const { session, loading, isStaff, profile, profileError, refreshProfile, signOut } = useAuth()

  if (loading) return <Spinner label="Starting IMPI SafetyFile Pro…" />
  if (!session) return <LoginPage />

  // Signed in, but we could not determine who this user is (a real failure,
  // not just "not staff") — show that plainly instead of guessing they're a
  // non-staff account, and instead of hanging on the spinner forever.
  if (!profile && profileError) {
    return (
      <div className="login-wrap">
        <div className="panel login-card">
          <h2>Couldn't load your account</h2>
          <p className="muted">
            Signed in, but the app couldn't read your profile. This is usually transient — try again,
            or sign out and back in if it keeps happening.
          </p>
          <div className="error-banner">{profileError.message || String(profileError)}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={refreshProfile}>Try again</button>
            <button className="btn-secondary" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </div>
    )
  }

  if (!isStaff) {
    return (
      <div className="login-wrap">
        <div className="panel login-card">
          <h2>Client portal not available yet</h2>
          <p className="muted">
            This account is not a staff account. The client-facing portal is a future phase.
          </p>
        </div>
      </div>
    )
  }

  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="clients" element={<ClientsPage />} />
          <Route path="clients/:id" element={<ClientDetailPage />} />
          <Route path="sectors" element={<SectorsPage />} />
          <Route path="checklists/:id" element={<ChecklistEditorPage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="documents" element={<DocumentBuilderPage />} />
          <Route path="audits" element={<AuditListPage />} />
          <Route path="audits/:id" element={<AuditWorkspacePage />} />
          <Route path="assembly" element={<FinalAssemblyPage />} />
          <Route path="register" element={<DocumentRegisterPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
