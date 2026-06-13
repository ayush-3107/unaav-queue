import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage.jsx';
import HomePage from './pages/HomePage.jsx';
import CustomersPage from './pages/CustomersPage.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';

export default function App() {
  console.log("App render");

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            <>
              {console.log("Login route")}
              <LoginPage />
            </>
          }
        />

        <Route
          path="/home"
          element={
            <>
              {console.log("Home route")}
              <ProtectedRoute>
                <HomePage />
              </ProtectedRoute>
            </>
          }
        />

        <Route
          path="/customers"
          element={
            <>
              {console.log("Customers route")}
              <ProtectedRoute>
                <CustomersPage />
              </ProtectedRoute>
            </>
          }
        />

        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </BrowserRouter>
  );
}