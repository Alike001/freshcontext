import { Navigate, Route, Routes } from 'react-router';

import { AppShell } from './components/app-shell.js';
import { SetupProvider } from './data/setup.js';
import { EvaluationPage } from './pages/evaluation.js';
import { OverviewPage } from './pages/overview.js';
import { ProofConsolePage } from './pages/proof-console.js';
import { SetupPage } from './pages/setup.js';

export function App() {
  return (
    <SetupProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="console" element={<ProofConsolePage />} />
          <Route path="evaluation" element={<EvaluationPage />} />
          <Route path="setup" element={<SetupPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </SetupProvider>
  );
}
