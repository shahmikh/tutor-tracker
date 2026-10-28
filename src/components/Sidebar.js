import React, { useEffect, useState } from "react";
import { auth } from "../firebase/config";
import { signOut } from "firebase/auth";
import { useAuth } from "../context/AuthContext";
import toast from "react-hot-toast";
import Icon from "./Icons";

export const TUTOR_NAV = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "students", label: "My Students", icon: "students" },
  { id: "availability", label: "My Availability", icon: "availability" },
  { id: "sessions", label: "Lessons", icon: "sessions" },
  { id: "packages", label: "Class Packages", icon: "packages" },
  { id: "assignments", label: "Assignments", icon: "assignments" },
  { id: "materials", label: "Study Materials", icon: "materials" },
  { id: "messages", label: "Messages", icon: "messages" },
  { id: "payments", label: "Payments", icon: "payments" },
  { id: "progress", label: "Progress", icon: "progress" },
  { id: "notifications", label: "Notifications", icon: "notifications" },
];

export const STUDENT_NAV = [
  { id: "dashboard", label: "Home", icon: "dashboard" },
  { id: "assignments", label: "My Assignments", icon: "assignments" },
  { id: "sessions", label: "My Lessons", icon: "sessions" },
  { id: "packages", label: "Class Packages", icon: "packages" },
  { id: "materials", label: "Study Materials", icon: "materials" },
  { id: "messages", label: "Messages", icon: "messages" },
  { id: "payments", label: "Payments", icon: "payments" },
  { id: "progress", label: "My Progress", icon: "progress" },
  { id: "notifications", label: "Notifications", icon: "notifications" },
];

const COLORS = ["#1D3A66", "#FF7A55", "#1E9E6A", "#7A5AF8", "#C98A00"];

export default function Sidebar({ active, onNav, unreadCount = 0, unreadMessages = 0 }) {
  const { userProfile } = useAuth();
  const [open, setOpen] = useState(false);
  const nav = userProfile?.role === "tutor" ? TUTOR_NAV : STUDENT_NAV;
  const color = COLORS[(userProfile?.name?.charCodeAt(0) || 0) % COLORS.length];

  useEffect(() => {
    const t = () => setOpen(o => !o);
    window.addEventListener("toggle-sidebar", t);
    return () => window.removeEventListener("toggle-sidebar", t);
  }, []);

  const logout = async () => {
    await signOut(auth);
    toast.success("Signed out successfully");
  };
  const go = (id) => { onNav(id); setOpen(false); };

  return (
    <>
      <div className={`sidebar-scrim ${open ? "open" : ""}`} onClick={() => setOpen(false)} />
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-logo">
          <div className="logo-row">
            <div className="logo-icon"><img src="/logo.svg" alt="" /></div>
            <div>
              <h2>Shahmikh<br />Classroom</h2>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {nav.map(item => {
            const badge = item.id === "notifications" ? unreadCount : item.id === "messages" ? unreadMessages : 0;
            return (
              <button key={item.id} className={`nav-item ${active === item.id ? "active" : ""}`} onClick={() => go(item.id)}>
                <span className="nav-icon"><Icon name={item.icon} /></span>
                {item.label}
                {badge > 0 && <span className="nav-badge">{badge}</span>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="user-avatar" style={{ background: color }}>{userProfile?.name?.charAt(0)?.toUpperCase()}</div>
            <div className="user-info">
              <div className="name">{userProfile?.name}</div>
              <div className="role">{userProfile?.role}</div>
            </div>
            <button className="logout-btn" onClick={logout} title="Sign out" aria-label="Sign out"><Icon name="logout" /></button>
          </div>
        </div>
      </aside>
    </>
  );
}
