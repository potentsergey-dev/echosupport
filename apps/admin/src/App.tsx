import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/query-client';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { AgentSettingsPage } from './pages/AgentSettingsPage';
import { AgentsIndexPage } from './pages/AgentsIndexPage';
import { InboxPage } from './pages/InboxPage';
import { SpecialistsPage } from './pages/SpecialistsPage';
import { ServicesPage } from './pages/ServicesPage';
import { AppointmentsPage } from './pages/AppointmentsPage';
import { CsatPage } from './pages/CsatPage';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/admin">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/agents"
            element={
              <ProtectedRoute>
                <AgentsIndexPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agents/:id"
            element={
              <ProtectedRoute>
                <AgentSettingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/inbox"
            element={
              <ProtectedRoute>
                <InboxPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/specialists"
            element={
              <ProtectedRoute>
                <SpecialistsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/services"
            element={
              <ProtectedRoute>
                <ServicesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/appointments"
            element={
              <ProtectedRoute>
                <AppointmentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/csat"
            element={
              <ProtectedRoute>
                <CsatPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/agents" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
