import { NavLink, Outlet } from 'react-router';

import { useSetup } from '../data/setup.js';

const navigation = [
  { to: '/', label: 'Overview', end: true },
  { to: '/console', label: 'Proof Console', end: false },
  { to: '/evaluation', label: 'Evaluation', end: false },
  { to: '/setup', label: 'Setup', end: false },
] as const;

export function AppShell() {
  const { resource } = useSetup();
  const connection =
    resource.state === 'loading'
      ? 'Checking HydraDB'
      : resource.state === 'ready' && resource.data.hydra === 'connected'
        ? 'HydraDB connected'
        : 'HydraDB unavailable';
  const connectionState =
    resource.state === 'loading'
      ? 'checking'
      : resource.state === 'ready' && resource.data.hydra === 'connected'
        ? 'connected'
        : 'unavailable';

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <NavLink className="wordmark" to="/" aria-label="FreshContext overview">
          <span className="wordmark-path" aria-hidden="true" />
          FreshContext
        </NavLink>
        <nav className="primary-nav" aria-label="Primary navigation">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className={`connection-state ${connectionState}`} aria-live="polite">
          <span className="connection-mark" aria-hidden="true" />
          {connection}
        </div>
      </header>
      <main id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
    </>
  );
}
