import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/query-client';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { AgentSettingsPage } from './pages/AgentSettingsPage';
import { AgentsIndexPage } from './pages/AgentsIndexPage';
import { InboxPage } from './pages/InboxPage';
import { SpecialistsPage } from './pages/SpecialistsPage';
import { ServicesPage } from './pages/ServicesPage';
import { AppointmentsPage } from './pages/AppointmentsPage';
import { CsatPage } from './pages/CsatPage';
import { isLiteEdition } from './lib/app-edition';
import { isAdminRole } from './lib/auth';
import { useWorkingMode } from './lib/working-mode';

function ConfigurationRoute({ children }: { children: React.ReactNode }) {
  const [workingMode] = useWorkingMode();
  if (!isLiteEdition && isAdminRole() && workingMode) {
    return <Navigate to="/inbox" replace />;
  }
  return <>{children}</>;
}
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
                <ConfigurationRoute>
                  <AgentsIndexPage />
                </ConfigurationRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/agents/:id"
            element={
              <ProtectedRoute>
                <ConfigurationRoute>
                  <AgentSettingsPage />
                </ConfigurationRoute>
              </ProtectedRoute>
            }
          />
          {!isLiteEdition && (
            <>
              <Route
                path="/inbox"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <InboxPage />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/specialists"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <ConfigurationRoute>
                        <SpecialistsPage />
                      </ConfigurationRoute>
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/services"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <ConfigurationRoute>
                        <ServicesPage />
                      </ConfigurationRoute>
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/appointments"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <AppointmentsPage />
                    </Layout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/csat"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <CsatPage />
                    </Layout>
                  </ProtectedRoute>
                }
              />
            </>
          )}
          <Route path="*" element={<Navigate to="/agents" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
