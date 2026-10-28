import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import TutorDashboard from "./pages/TutorDashboard";
import StudentDashboard from "./pages/StudentDashboard";
import "./App.css";

function AppRoutes() {
  const { currentUser, userProfile, loading } = useAuth();

  if (loading) return (
    <div className="loading-screen">
      <div className="loader-ring"></div>
      <p>Loading Shahmikh Classroom...</p>
    </div>
  );

  if (!currentUser) return <Login />;
  if (userProfile?.role === "tutor") return (
    <Routes>
      <Route path="/*" element={<TutorDashboard />} />
    </Routes>
  );
  if (userProfile?.role === "student") return (
    <Routes>
      <Route path="/*" element={<StudentDashboard />} />
    </Routes>
  );

  return <Login />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" toastOptions={{
          style: { background: "#0B1F3A", color: "#fff", borderRadius: "999px", fontFamily: "DM Sans, sans-serif", fontSize: "14px" },
          success: { iconTheme: { primary: "#FF7A55", secondary: "#fff" } },
          duration: 4000
        }} />
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
