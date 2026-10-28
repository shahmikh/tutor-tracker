import React from "react";
const P = {
  dashboard: "M3 11.5 12 4l9 7.5M5 10v10h5v-6h4v6h5V10",
  students: "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.2a3.5 3.5 0 0 1 0 6.6",
  availability: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  sessions: "M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7zM4 10h16M8 3v4M16 3v4",
  packages: "M3 9a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v6a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2V9zM13 7v10",
  assignments: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5M9 13h6M9 17h4",
  materials: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16zM4 19.5A2.5 2.5 0 0 1 6.5 17H20",
  messages: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z",
  payments: "M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zM3 10h18M7 15h3",
  progress: "M4 20V10M10 20V4M16 20v-8M22 20H2",
  notifications: "M18 16v-5a6 6 0 1 0-12 0v5l-2 2h16l-2-2zM10 21a2 2 0 0 0 4 0",
  logout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4",
  menu: "M4 6h16M4 12h16M4 18h16",
  video: "M3 7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zM15 10l6-3v10l-6-3",
  plus: "M12 5v14M5 12h14",
  book: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16z",
  check: "M5 13l4 4L19 7",
  shield: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z",
};
export default function Icon({ name, size = 20, stroke = 1.9 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] || P.dashboard} />
    </svg>
  );
}
