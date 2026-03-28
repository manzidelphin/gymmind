import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { GymProvider } from './context/GymContext';
import { ToastProvider } from './context/ToastContext';
import { ToastContainer } from './components/Toast/Toast';
import CheckIn from './pages/CheckIn';
import ClaimAccount from './pages/ClaimAccount';
import ManagerDashboard from './pages/ManagerDashboard';
import MemberPortal from './pages/MemberPortal';
import SuperAdminDashboard from './pages/SuperAdminDashboard';
import RegisterGym from './pages/RegisterGym';
import Signup from './pages/Signup';
import Landing from './pages/Landing';
import Login from './pages/Login';
import InstitutionPortal from './pages/InstitutionPortal';
import InstitutionLogin from './pages/InstitutionLogin';

function GymRoutes() {
  return (
    <GymProvider>
      <Routes>
        <Route path="checkin" element={<CheckIn />} />
        <Route path="claim"   element={<ClaimAccount />} />
        <Route path="manager" element={<ManagerDashboard />} />
        <Route path="member"  element={<MemberPortal />} />
        <Route path="*" element={<Navigate to="checkin" replace />} />
      </Routes>
    </GymProvider>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/admin"    element={<SuperAdminDashboard />} />
          <Route path="/register" element={<RegisterGym />} />
          <Route path="/signup"   element={<Signup />} />
          <Route path="/login"    element={<Login />} />
          <Route path="/institution/login" element={<InstitutionLogin />} />
          <Route path="/institution/:institutionSlug" element={<InstitutionPortal />} />
          <Route path="/:gymSlug/*" element={<GymRoutes />} />
          <Route path="/" element={<Landing />} />
        </Routes>
      </BrowserRouter>
      <ToastContainer />
    </ToastProvider>
  );
}
