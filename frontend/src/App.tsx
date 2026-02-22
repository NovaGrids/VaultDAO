import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import DashboardLayout from './components/Layout/DashboardLayout';
import Overview from './app/dashboard/Overview';
import Proposals from './app/dashboard/Proposals';
import Activity from './app/dashboard/Activity';
import Analytics from './app/dashboard/Analytics';
import Settings from './app/dashboard/Settings';
import Templates from './app/dashboard/Templates';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<Overview />} />
          <Route path="proposals" element={<Proposals />} />
          <Route path="activity" element={<Activity />} />
          <Route path="templates" element={<Templates />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="settings" element={<Settings />} />
        </Route>

        {/* Toast Demo Route */}
        {/* <Route path="/toast-demo" element={<ToastDemo />} /> */}
      </Routes>
    </Router>
  );
}

export default App;