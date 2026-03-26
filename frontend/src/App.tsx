// frontend/src/App.tsx

import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import DashboardLayout from './components/Layout/DashboardLayout';
import ErrorBoundary from './components/ErrorBoundary';

const Overview = lazy(() => import('./app/dashboard/Overview'));
const Proposals = lazy(() => import('./app/dashboard/Proposals'));
const Activity = lazy(() => import('./app/dashboard/Activity'));
const Analytics = lazy(() => import('./app/dashboard/Analytics'));
const Settings = lazy(() => import('./app/dashboard/Settings'));
const Templates = lazy(() => import('./app/dashboard/Templates'));
const RecurringPayments = lazy(() => import('./app/dashboard/RecurringPayments'));
const ErrorDashboard = lazy(() => import('./components/ErrorDashboard'));

const PageFallback = () => (
  <div className="flex items-center justify-center h-64">
    <div className="animate-spin rounded-full h-10 w-10 border-2 border-purple-500 border-t-transparent" />
  </div>
);

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardLayout />}>
              <Route index element={<Overview />} />
              <Route path="proposals" element={<Proposals />} />
              <Route path="activity" element={<Activity />} />
              <Route path="templates" element={<Templates />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="recurring-payments" element={<RecurringPayments />} />
              <Route path="settings" element={<Settings />} />
              <Route path="errors" element={<ErrorDashboard />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
