// frontend/src/App.tsx

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Navigate } from 'react-router-dom';
import DashboardLayout from './components/Layout/DashboardLayout';
import Overview from './app/dashboard/Overview';
import Proposals from './app/dashboard/Proposals';
import Activity from './app/dashboard/Activity';
import Analytics from './app/dashboard/Analytics';
import Settings from './app/dashboard/Settings';
import Templates from './app/dashboard/Templates';
import RecurringPayments from './app/dashboard/RecurringPayments';
import ErrorDashboard from './components/ErrorDashboard';

function App() {
  return (
    <BrowserRouter>
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

        {/* Toast Demo Route */}
        {/* <Route path="/toast-demo" element={<ToastDemo />} /> */}
      </Routes>
    </BrowserRouter>
  );
}

export default App;