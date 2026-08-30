import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider.jsx'

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/clients', label: 'Clients' },
  { to: '/sectors', label: 'Sectors & Checklists' },
  { to: '/library', label: 'Hazard / Method Library' },
  { to: '/documents', label: 'Document Builder' },
  { to: '/audits', label: 'Audits' },
  { to: '/assembly', label: 'Final Assembly' },
  { to: '/register', label: 'Document Register' },
]

export default function Layout() {
  const { profile, user, signOut } = useAuth()
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          IMPI SafetyFile Pro
          <small>IMPI Protection Agency</small>
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            {n.label}
          </NavLink>
        ))}
        <div className="spacer" />
        <div className="user">
          {profile?.full_name || user?.email}
          <br />
          <span style={{ opacity: 0.7 }}>{profile?.role || 'staff'}</span>
        </div>
        <button className="btn-ghost btn-sm" style={{ color: '#d6dce4', borderColor: 'rgba(255,255,255,0.2)' }} onClick={signOut}>
          Sign out
        </button>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
