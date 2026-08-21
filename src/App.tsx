import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LoginPage } from './pages/LoginPage'
import { SetPasswordPage } from './pages/SetPasswordPage'
import { NotEligiblePage } from './pages/NotEligiblePage'
import { BallotPlaceholderPage } from './pages/BallotPlaceholderPage'
import { ReviewBallotPage } from './pages/ReviewBallotPage'
import { ConfirmationPage } from './pages/ConfirmationPage'
import { AdminDashboardPage } from './pages/AdminDashboardPage'
import { NominationsPage } from './pages/NominationsPage'
import { VoterDashboardPage } from './pages/VoterDashboardPage'
import { ProtectedVoterRoute } from './routes/ProtectedVoterRoute'
import { ProtectedAdminRoute } from './routes/ProtectedAdminRoute'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/set-password" element={<SetPasswordPage />} />
        <Route path="/nominations" element={<NominationsPage />} />
        <Route path="/not-eligible" element={<NotEligiblePage />} />
        <Route path="/confirmation" element={<ConfirmationPage />} />
        <Route path="/dashboard" element={<VoterDashboardPage />} />
        <Route element={<ProtectedAdminRoute />}>
          <Route path="/admin" element={<AdminDashboardPage />} />
        </Route>
        <Route element={<ProtectedVoterRoute />}>
          <Route path="/ballot" element={<BallotPlaceholderPage />} />
          <Route path="/review" element={<ReviewBallotPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
