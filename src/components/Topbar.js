import React from "react";
import Icon from "./Icons";
import { TUTOR_NAV, STUDENT_NAV } from "./Sidebar";
import { useAuth } from "../context/AuthContext";

export default function Topbar({ page, onNav, unreadCount = 0, unreadMessages = 0 }) {
  const { userProfile } = useAuth();
  const nav = userProfile?.role === "tutor" ? TUTOR_NAV : STUDENT_NAV;
  const title = nav.find(n => n.id === page)?.label || "Shahmikh Classroom";
  return (
    <header className="topbar">
      <button className="topbar-btn menu-btn" aria-label="Menu" onClick={() => window.dispatchEvent(new Event("toggle-sidebar"))}><Icon name="menu" /></button>
      <div className="topbar-title">{title}</div>
      <div className="topbar-spacer" />
      <button className="topbar-btn" aria-label="Messages" title="Messages" onClick={() => onNav("messages")}>
        <Icon name="messages" />{unreadMessages > 0 && <span className="pip">{unreadMessages}</span>}
      </button>
      <button className="topbar-btn" aria-label="Notifications" title="Notifications" onClick={() => onNav("notifications")}>
        <Icon name="notifications" />{unreadCount > 0 && <span className="pip">{unreadCount}</span>}
      </button>
    </header>
  );
}
