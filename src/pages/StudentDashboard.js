import React, { useState, useEffect } from "react";
import { db } from "../firebase/config";
import { ref, onValue, set, push } from "firebase/database";
import { useAuth } from "../context/AuthContext";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";
import CountUp from "../components/CountUp";
import toast from "react-hot-toast";
import { format } from "date-fns";
import { getNextDays, getNextDaysLocal, pktToUtc, formatInLocal, formatInPKT, getLocalTimezone, DAYS, getCountdown } from "../utils/timezone";
import { sendEmail } from "../utils/email";
import { uploadFile } from "../utils/storage";
import { ChatWindow, useUnreadCount } from "../components/Chat";
import { AvailabilityGridViewer, getRangesFromPaintedRows, generateSlots } from "../components/AvailabilityGrid";

function notify(db, uid, message, type = "info") {
  if (!uid) return;
  push(ref(db, `users/${uid}/notifications`), { message, type, read: false, createdAt: Date.now() });
}

function fmt12(t) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h === 0 || h < 12 ? "AM" : "PM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2,"0")} ${ampm}`;
}

export default function StudentDashboard() {
  const { currentUser, userProfile } = useAuth();
  const [page, setPage] = useState("dashboard");
  const [assignments, setAssignments] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [tutorInfo, setTutorInfo] = useState(null);
  const [availability, setAvailability] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [, setTick] = useState(0); // forces re-render every minute for live countdowns

  // Modals
  const [submitModal, setSubmitModal] = useState(null);
  const [bookModal, setBookModal] = useState(false);
  const [studentReschedule, setStudentReschedule] = useState(null);
  const [studentCancel, setStudentCancel] = useState(null);
  const [submitNote, setSubmitNote] = useState("");
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfUploading, setPdfUploading] = useState(false);
  const [invoices, setInvoices] = useState([]);
  const [proofModal, setProofModal] = useState(null);
  const [proofFile, setProofFile] = useState(null);
  const [proofUploading, setProofUploading] = useState(false);
  const unreadMessages = useUnreadCount(currentUser.uid, tutorInfo?.uid);
  const [packages, setPackages] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [availabilityGrid, setAvailabilityGrid] = useState({});
  const [tutorAllSessions, setTutorAllSessions] = useState([]);

  // Booking state
  const [selectedDay, setSelectedDay] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);

  const localTZ = getLocalTimezone();
  const nextDays = getNextDaysLocal(60);

  useEffect(() => {
    const tutorRef = ref(db, `students/${currentUser.uid}/tutor`);
    onValue(tutorRef, snap => {
      const t = snap.val();
      setTutorInfo(t);
      if (t?.uid) {
        // Load tutor's availability (legacy)
        onValue(ref(db, `availability/${t.uid}`), snap2 => {
          const d = snap2.val() || {};
          setAvailability(Object.entries(d).map(([id, v]) => ({ id, ...v })));
        });
        // Load tutor's new drag-paint availability grid
        onValue(ref(db, `availabilityGrid/${t.uid}`), snap3 => {
          setAvailabilityGrid(snap3.val() || {});
        });
        // Load ALL of the tutor's sessions (across every student) to detect time conflicts when booking
        onValue(ref(db, `tutors/${t.uid}/sessions`), snap4 => {
          const d = snap4.val() || {};
          setTutorAllSessions(Object.entries(d).map(([id, v]) => ({ id, ...v })).filter(s => s.status === "scheduled" || s.status === "completed"));
        });
      }
    });
    onValue(ref(db, `students/${currentUser.uid}/assignments`), snap => {
      const d = snap.val() || {};
      setAssignments(Object.entries(d).map(([id, v]) => ({ id, ...v })).sort((a,b) => b.createdAt - a.createdAt));
    });
    onValue(ref(db, `students/${currentUser.uid}/sessions`), snap => {
      const d = snap.val() || {};
      setSessions(Object.entries(d).map(([id, v]) => ({ id, ...v })).sort((a,b) => (b.utcTimestamp||0) - (a.utcTimestamp||0)));
    });
    onValue(ref(db, `users/${currentUser.uid}/notifications`), snap => {
      const d = snap.val() || {};
      const arr = Object.entries(d).map(([id, v]) => ({ id, ...v })).sort((a,b) => b.createdAt - a.createdAt);
      setNotifications(arr);
      setUnread(arr.filter(n => !n.read).length);
    });
    onValue(ref(db, `students/${currentUser.uid}/invoices`), snap => {
      const d = snap.val() || {};
      setInvoices(Object.entries(d).map(([id, v]) => ({ id, ...v })).sort((a,b) => b.createdAt - a.createdAt));
    });
    onValue(ref(db, `students/${currentUser.uid}/packages`), snap => {
      const d = snap.val() || {};
      setPackages(Object.entries(d).map(([id, v]) => ({ id, ...v })).sort((a,b) => b.createdAt - a.createdAt));
    });
    onValue(ref(db, `students/${currentUser.uid}/materials`), snap => {
      const d = snap.val() || {};
      setMaterials(Object.entries(d).map(([id, v]) => ({ id, ...v })).sort((a,b) => b.createdAt - a.createdAt));
    });
  }, [currentUser.uid]);

  // Refresh countdown timers every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  // Get available slots for a specific date
  const getSlotsForDate = (dateObj) => {
    return availability.filter(slot => slot.day === dateObj.dayName);
  };

  // Shifts a YYYY-MM-DD date string by N days (handles month/year rollover correctly)
  const shiftDateString = (dateStr, days) => {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + days);
    return d.toISOString().split("T")[0];
  };

  // Given the calendar date the student SEES (display date) and a slot carrying a dayOffset,
  // returns the actual PKT calendar date to use for booking math.
  const toPktDate = (displayDate, slot) => shiftDateString(displayDate, slot.dayOffset || 0);

  // Checks if a given display-date + slot overlaps with any existing booked session for this tutor (any student)
  const hasConflict = (displayDate, slot) => {
    const pktDate = toPktDate(displayDate, slot);
    const newStart = pktToUtc(pktDate, slot.startPKT);
    const newEnd = pktToUtc(pktDate, slot.endPKT);
    return tutorAllSessions.some(s => {
      if (!s.utcTimestamp) return false;
      const existingStart = s.utcTimestamp;
      const existingEnd = existingStart + (s.duration || 50) * 60000;
      return newStart < existingEnd && newEnd > existingStart;
    });
  };

  const bookSession = async () => {
    if (!selectedSlot || !selectedDate) {
      toast.error("Please select a date and timeslot."); return;
    }
    if (hasConflict(selectedDate.date, selectedSlot)) {
      toast.error("This slot was just booked by someone else. Please pick another time.");
      setSelectedDate(null);
      return;
    }
    const topic = studentReschedule ? studentReschedule.topic : "Tutoring Session";
    const pktDate = toPktDate(selectedDate.date, selectedSlot);
    const utcTimestamp = pktToUtc(pktDate, selectedSlot.startPKT);
    const activePkg = packages.find(p => p.status === "active" && p.studentIds.includes(currentUser.uid));

    if (studentReschedule) {
      // RESCHEDULE — update the existing session in both paths
      const updatedFields = { date: selectedDate.date, slotDay: selectedSlot.day, slotStartPKT: selectedSlot.startPKT, slotEndPKT: selectedSlot.endPKT, duration: selectedSlot.duration, utcTimestamp, status: "scheduled" };
      for (const [k, v] of Object.entries(updatedFields)) {
        await set(ref(db, `students/${currentUser.uid}/sessions/${studentReschedule.id}/${k}`), v);
        await set(ref(db, `tutors/${tutorInfo.uid}/sessions/${studentReschedule.id}/${k}`), v);
      }
      notify(db, tutorInfo.uid, `${userProfile.name} rescheduled their session "${topic}" to ${fmt12(selectedSlot.startPKT)} PKT on ${pktDate} 🔄`, "session");
      sendEmail(tutorInfo.email || "", tutorInfo.name,
        `Session Rescheduled 🔄`,
        `Hi ${tutorInfo.name},\n\n${userProfile.name} has rescheduled their session:\n\nTopic: ${topic}\nNew Time (PKT): ${fmt12(selectedSlot.startPKT)} – ${fmt12(selectedSlot.endPKT)} on ${pktDate}\n\nLog in to Shahmikh Classroom to see the updated schedule.`
      );
      toast.success("Session rescheduled!");
      setStudentReschedule(null);
    } else {
      // NEW BOOKING
      const sessionData = {
        topic,
        studentId: currentUser.uid,
        studentName: userProfile.name,
        tutorId: tutorInfo.uid,
        tutorName: tutorInfo.name,
        utcTimestamp,
        duration: selectedSlot.duration,
        slotDay: selectedSlot.day,
        slotStartPKT: selectedSlot.startPKT,
        slotEndPKT: selectedSlot.endPKT,
        date: selectedDate.date,
        status: "scheduled",
        createdAt: Date.now(),
        studentTimezone: localTZ,
        ...(activePkg && { packageId: activePkg.id, packageName: activePkg.name })
      };
      const newRef = push(ref(db, `tutors/${tutorInfo.uid}/sessions`));
      await set(newRef, sessionData);
      await set(ref(db, `students/${currentUser.uid}/sessions/${newRef.key}`), sessionData);
      notify(db, tutorInfo.uid, `${userProfile.name} booked a session on ${pktDate} at ${fmt12(selectedSlot.startPKT)} PKT 📅`, "session");
      sendEmail(tutorInfo.email || "", tutorInfo.name,
        `New Session Booked 📅`,
        `Hi ${tutorInfo.name},\n\n${userProfile.name} has booked a session with you.\n\nYour Time (PKT): ${fmt12(selectedSlot.startPKT)} – ${fmt12(selectedSlot.endPKT)} on ${pktDate}\nDuration: ${selectedSlot.duration} minutes\n\nLog in to Shahmikh Classroom to manage your sessions.`
      );
      toast.success("Session booked successfully!");
    }

    setBookModal(false); setSelectedSlot(null); setSelectedDate(null); setSelectedDay(null);
  };

  const submitAssignment = async () => {
    const a = submitModal;
    setPdfUploading(true);
    let submissionUrl = null;
    let submissionName = null;

    if (pdfFile) {
      submissionUrl = await uploadFile(pdfFile, `submissions/${currentUser.uid}/${Date.now()}_${pdfFile.name}`);
      submissionName = pdfFile.name;
    }

    await set(ref(db, `students/${currentUser.uid}/assignments/${a.id}/status`), "submitted");
    await set(ref(db, `students/${currentUser.uid}/assignments/${a.id}/submittedNote`), submitNote);
    await set(ref(db, `students/${currentUser.uid}/assignments/${a.id}/submittedAt`), Date.now());
    if (submissionUrl) {
      await set(ref(db, `students/${currentUser.uid}/assignments/${a.id}/submissionUrl`), submissionUrl);
      await set(ref(db, `students/${currentUser.uid}/assignments/${a.id}/submissionName`), submissionName);
    }

    if (a.tutorAssignmentPath) {
      await set(ref(db, `${a.tutorAssignmentPath}/status`), "submitted");
      await set(ref(db, `${a.tutorAssignmentPath}/submittedNote`), submitNote);
      await set(ref(db, `${a.tutorAssignmentPath}/submittedAt`), Date.now());
      if (submissionUrl) {
        await set(ref(db, `${a.tutorAssignmentPath}/submissionUrl`), submissionUrl);
        await set(ref(db, `${a.tutorAssignmentPath}/submissionName`), submissionName);
      }
    }

    if (tutorInfo?.uid) {
      notify(db, tutorInfo.uid, `${userProfile.name} submitted "${a.title}" ✅`, "submission");
      sendEmail(
        tutorInfo.email || "",
        tutorInfo.name,
        `Assignment Submitted: ${a.title} ✅`,
        `Hi ${tutorInfo.name},\n\n${userProfile.name} has submitted the assignment "${a.title}".\n\n${submitNote ? `Student note: ${submitNote}\n\n` : ""}${pdfName ? `PDF attached: ${pdfName}\n\n` : ""}Log in to Shahmikh Classroom to review and grade it.`
      );
    }

    toast.success("Assignment submitted!");
    setPdfUploading(false);
    setSubmitModal(null); setSubmitNote(""); setPdfFile(null);
  };

  const cancelStudentSession = async (s) => {
    await set(ref(db, `students/${currentUser.uid}/sessions/${s.id}/status`), "cancelled");
    await set(ref(db, `tutors/${tutorInfo.uid}/sessions/${s.id}/status`), "cancelled");
    notify(db, tutorInfo.uid, `${userProfile.name} cancelled their session "${s.topic}" on ${s.date} ❌`, "session");
    sendEmail(tutorInfo.email || "", tutorInfo.name,
      `Session Cancelled ❌`,
      `Hi ${tutorInfo.name},\n\n${userProfile.name} has cancelled their session:\n\nTopic: ${s.topic}\nOriginal Time (PKT): ${s.utcTimestamp ? formatInPKT(s.utcTimestamp) : s.date}\n\nLog in to Shahmikh Classroom to manage your schedule.`
    );
    toast.success("Session cancelled.");
    setStudentCancel(null);
  };

  // When student presses reschedule, we open bookModal with studentReschedule set.
  // bookSession detects this and updates instead of creating.
  const uploadProof = async () => {
    if (!proofFile || !proofModal) { toast.error("Please select a file."); return; }
    setProofUploading(true);
    const proofUrl = await uploadFile(proofFile, `proofs/${currentUser.uid}/${Date.now()}_${proofFile.name}`);
    const proofName = proofFile.name;

    await set(ref(db, `students/${currentUser.uid}/invoices/${proofModal.id}/proofUrl`), proofUrl);
    await set(ref(db, `students/${currentUser.uid}/invoices/${proofModal.id}/proofName`), proofName);
    await set(ref(db, `students/${currentUser.uid}/invoices/${proofModal.id}/status`), "paid");
    if (proofModal.tutorInvoicePath) {
      await set(ref(db, `${proofModal.tutorInvoicePath}/proofUrl`), proofUrl);
      await set(ref(db, `${proofModal.tutorInvoicePath}/proofName`), proofName);
      await set(ref(db, `${proofModal.tutorInvoicePath}/status`), "paid");
    }
    if (tutorInfo?.uid) {
      notify(db, tutorInfo.uid, `${userProfile.name} uploaded payment proof for ${proofModal.month} ✅`, "payment");
      sendEmail(tutorInfo.email || "", tutorInfo.name,
        `Payment Proof Uploaded: ${proofModal.month} ✅`,
        `Hi ${tutorInfo.name},\n\n${userProfile.name} has uploaded payment proof for the ${proofModal.month} invoice (${proofModal.currency}${proofModal.amount}).\n\nLog in to Shahmikh Classroom to view it.`
      );
    }
    toast.success("Payment proof uploaded!");
    setProofUploading(false);
    setProofModal(null); setProofFile(null);
  };

  const markNotifRead = (nid) => set(ref(db, `users/${currentUser.uid}/notifications/${nid}/read`), true);
  const markAllRead = () => notifications.forEach(n => { if (!n.read) markNotifRead(n.id); });

  const pending = assignments.filter(a => a.status==="pending").length;
  const submitted = assignments.filter(a => a.status==="submitted").length;
  const graded = assignments.filter(a => a.status==="graded");
  const avg = graded.length ? Math.round(graded.reduce((s,a) => s+(a.obtainedMarks/a.totalMarks)*100, 0)/graded.length) : null;
  const upcomingSessions = sessions.filter(s => s.status==="scheduled");

  return (
    <div className="app-layout">
      <Sidebar active={page} onNav={setPage} unreadCount={unread} unreadMessages={unreadMessages} />
      <div className="main-content">
        <Topbar page={page} onNav={setPage} unreadCount={unread} unreadMessages={unreadMessages} />
        <div className="page-body">

        {/* DASHBOARD */}
        {page === "dashboard" && (
          <>
            <div className="page-header">
              <h1>Welcome back, {userProfile?.name?.split(" ")[0]}</h1>
              <p>Your learning dashboard{tutorInfo ? ` · Tutor: ${tutorInfo.name}` : ""} · Times shown in <strong style={{color:"var(--accent-teal)"}}>{localTZ}</strong></p>
            </div>
            {(() => {
              const next = [...upcomingSessions].filter(x => (x.utcTimestamp||0) > Date.now()-3600000).sort((a,b) => (a.utcTimestamp||0) - (b.utcTimestamp||0))[0];
              return (
                <div className="hero-card">
                  <div style={{position:"relative",zIndex:1}}>
                    <div className="eyebrow">{next ? "Your next lesson" : "Ready to learn?"}</div>
                    <h2>{next ? next.topic : "Book your next lesson"}</h2>
                    <p>{next ? `${next.utcTimestamp ? formatInLocal(next.utcTimestamp) : next.date} · ${next.duration} min${tutorInfo ? ` · with ${tutorInfo.name}` : ""}` : "Pick a time that works for you in your own timezone."}</p>
                    {next && next.utcTimestamp && <div className="countdown"><span className="live"></span>Starts {getCountdown(next.utcTimestamp)}</div>}
                  </div>
                  <div className="cta">
                    {tutorInfo && <button className="btn-hero" onClick={() => setBookModal(true)}>Book a lesson</button>}
                    <button className="btn-hero ghost" onClick={() => setPage("assignments")}>My assignments</button>
                  </div>
                </div>
              );
            })()}

            <div className="stats-row">
              <div className="stat-card"><div className="stat-label">Pending</div><div className="stat-value color-rose"><CountUp value={pending} /></div><div className="stat-sub">Assignments due</div></div>
              <div className="stat-card"><div className="stat-label">Submitted</div><div className="stat-value color-amber"><CountUp value={submitted} /></div><div className="stat-sub">Awaiting grade</div></div>
              <div className="stat-card"><div className="stat-label">Sessions</div><div className="stat-value color-blue"><CountUp value={upcomingSessions.length} /></div><div className="stat-sub">Upcoming</div></div>
              <div className="stat-card"><div className="stat-label">Avg Score</div><div className="stat-value color-teal">{avg!=null?`${avg}%`:"—"}</div><div className="stat-sub">Overall performance</div></div>
            </div>
            <div className="grid-2">
              <div className="card">
                <div className="card-header"><h3>Upcoming Sessions</h3>{tutorInfo && <button className="btn btn-blue btn-sm" onClick={() => setBookModal(true)}>+ Book Session</button>}</div>
                {upcomingSessions.length === 0
                  ? <div className="empty-state"><div className="empty-icon">📅</div><p>No sessions scheduled yet</p></div>
                  : [...upcomingSessions].sort((a,b) => (a.utcTimestamp||0) - (b.utcTimestamp||0)).slice(0,4).map(s => (
                    <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 0",borderBottom:"1px solid var(--border)"}}>
                      <div>
                        <div style={{fontWeight:600,fontSize:14}}>{s.topic}</div>
                        <div style={{fontSize:12,color:"var(--text-secondary)",marginTop:2}}>
                          {s.utcTimestamp ? formatInLocal(s.utcTimestamp) : `${s.date} ${s.slotStartPKT}`} · {s.duration} min
                        </div>
                      </div>
                      <span className="badge badge-blue">{s.utcTimestamp ? getCountdown(s.utcTimestamp) : "Scheduled"}</span>
                    </div>
                  ))
                }
              </div>
              <div className="card">
                <div className="card-header"><h3>Recent Notifications</h3></div>
                {notifications.length === 0
                  ? <div className="empty-state"><div className="empty-icon">🔔</div><p>Nothing yet</p></div>
                  : <div className="activity-feed">{notifications.slice(0,5).map(n => (
                    <div key={n.id} className="activity-item">
                      <div className="activity-dot" style={{background:n.read?"var(--text-muted)":"var(--accent-blue)"}}></div>
                      <div><div className="activity-text" style={{fontWeight:n.read?400:600}}>{n.message}</div><div className="activity-time">{format(new Date(n.createdAt),"MMM d, h:mm a")}</div></div>
                    </div>
                  ))}</div>
                }
              </div>
            </div>
          </>
        )}

        {/* BOOK SESSION PAGE */}
        {page === "sessions" && (
          <>
            <div className="page-header" style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <h1>Sessions</h1>
                <p>Times shown in your local time: <strong style={{color:"var(--accent-teal)"}}>{localTZ}</strong></p>
              </div>
              {tutorInfo && <button className="btn btn-blue" onClick={() => setBookModal(true)}>+ Book Session</button>}
            </div>
            <div className="card">
              {sessions.length === 0
                ? <div className="empty-state"><div className="empty-icon">📅</div><p>No sessions yet. Book one above!</p></div>
                : <table className="data-table"><thead><tr><th>Topic</th><th>Your Local Time</th><th>Tutor Time (PKT)</th><th>Duration</th><th>Status</th><th></th></tr></thead>
                  <tbody>{sessions.map(s => (
                    <tr key={s.id}>
                      <td style={{fontWeight:500}}>{s.topic}</td>
                      <td style={{fontSize:12,color:"var(--text-secondary)"}}>{s.utcTimestamp ? formatInLocal(s.utcTimestamp) : `${s.date} ${s.slotStartPKT}`}</td>
                      <td style={{fontSize:12,color:"var(--text-secondary)"}}>{s.utcTimestamp ? formatInPKT(s.utcTimestamp) : "—"}</td>
                      <td style={{color:"var(--text-secondary)"}}>{s.duration} min</td>
                      <td><span className={`badge ${s.status==="completed"?"badge-green":s.status==="cancelled"?"badge-rose":"badge-blue"}`}>{s.status}</span></td>
                      <td>
                        {s.status==="scheduled" && (
                          <div style={{display:"flex",gap:6}}>
                            <button className="btn btn-sm btn-outline" onClick={() => { setStudentReschedule(s); setBookModal(true); }}>🔄</button>
                            <button className="btn btn-sm btn-danger" onClick={() => setStudentCancel(s)}>❌</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              }
            </div>
          </>
        )}

        {/* ASSIGNMENTS */}
        {page === "assignments" && (
          <>
            <div className="page-header"><h1>My Assignments</h1><p>Assignments from your tutor</p></div>
            {assignments.length === 0
              ? <div className="card"><div className="empty-state"><div className="empty-icon">📝</div><p>No assignments yet. Your tutor will send them here.</p></div></div>
              : assignments.map(a => (
                <div key={a.id} className="card" style={{marginBottom:16}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div>
                      <div style={{fontWeight:600,fontSize:16,marginBottom:4}}>{a.title}</div>
                      <div style={{fontSize:13,color:"var(--text-secondary)"}}>{a.subject && `${a.subject} · `}Due: {a.dueDate}</div>
                      {a.description && <div style={{fontSize:13,color:"var(--text-secondary)",marginTop:8}}>{a.description}</div>}
                      {a.pdfName && (
                        <a href={a.pdfUrl} download={a.pdfName} style={{display:"inline-flex",alignItems:"center",gap:6,marginTop:10,padding:"6px 12px",background:"rgba(61,142,240,0.1)",borderRadius:6,fontSize:13,color:"var(--accent-blue)",textDecoration:"none"}}>
                          📄 Tutor's Attachment: {a.pdfName}
                        </a>
                      )}
                      {a.submissionName && (
                        <a href={a.submissionUrl} download={a.submissionName} style={{display:"inline-flex",alignItems:"center",gap:6,marginTop:6,padding:"6px 12px",background:"rgba(56,201,176,0.1)",borderRadius:6,fontSize:13,color:"var(--accent-teal)",textDecoration:"none"}}>
                          📤 Your Submission: {a.submissionName}
                        </a>
                      )}
                      {a.feedback && <div style={{marginTop:10,padding:"8px 12px",background:"rgba(56,201,176,0.08)",borderRadius:8,fontSize:13,color:"var(--accent-teal)"}}>💬 Feedback: {a.feedback}</div>}
                      {a.feedbackPdfName && (
                        <a href={a.feedbackPdfUrl} download={a.feedbackPdfName}
                          style={{display:"inline-flex",alignItems:"center",gap:6,marginTop:8,padding:"6px 12px",background:"rgba(61,142,240,0.1)",borderRadius:6,fontSize:13,color:"var(--accent-blue)",textDecoration:"none"}}>
                          📄 Download Feedback PDF: {a.feedbackPdfName}
                        </a>
                      )}
                    </div>
                    <div style={{textAlign:"right",flexShrink:0,marginLeft:16}}>
                      <span className={`badge ${a.status==="graded"?"badge-green":a.status==="submitted"?"badge-amber":"badge-rose"}`}>{a.status}</span>
                      {a.obtainedMarks!=null && <div style={{fontSize:20,fontWeight:700,color:"var(--accent-teal)",marginTop:8}}>{a.obtainedMarks}<span style={{fontSize:13,color:"var(--text-secondary)"}}>/{a.totalMarks}</span></div>}
                    </div>
                  </div>
                  <div style={{marginTop:14,display:"flex",gap:8}}>
                    {a.status==="pending" && <button className="btn btn-blue btn-sm" onClick={() => setSubmitModal(a)}>Submit Assignment</button>}
                  </div>
                </div>
              ))
            }
          </>
        )}

        {/* PROGRESS */}
        {page === "progress" && (
          <>
            <div className="page-header"><h1>My Progress</h1><p>Track your performance over time</p></div>

            {/* Top stats */}
            <div className="stats-row" style={{marginBottom:24}}>
              <div className="stat-card"><div className="stat-label">Total Assignments</div><div className="stat-value color-blue">{assignments.length}</div></div>
              <div className="stat-card"><div className="stat-label">Submitted</div><div className="stat-value color-amber">{assignments.filter(a=>a.status!=="pending").length}</div></div>
              <div className="stat-card"><div className="stat-label">Graded</div><div className="stat-value color-teal">{graded.length}</div></div>
              <div className="stat-card"><div className="stat-label">Average Score</div><div className="stat-value color-teal">{avg!=null?`${avg}%`:"—"}</div></div>
            </div>

            {graded.length === 0
              ? <div className="card"><div className="empty-state"><div className="empty-icon">📊</div><p>No graded assignments yet. Your charts will appear here once your tutor grades your work.</p></div></div>
              : <>
                {/* Score trend + Sessions chart side by side */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>

                  {/* Score trend */}
                  <div className="card" style={{marginBottom:0}}>
                    <div style={{fontWeight:600,marginBottom:16}}>📈 Score Trend</div>
                    {(() => {
                      const trend = graded.sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)).slice(-8).map(a=>({
                        name: a.title.length>12 ? a.title.slice(0,12)+"…" : a.title,
                        score: Math.round((a.obtainedMarks/a.totalMarks)*100)
                      }));
                      if (trend.length < 2) return <p style={{fontSize:13,color:"var(--text-muted)"}}>Need 2+ graded assignments to show trend.</p>;
                      return (
                        <>
                          <svg viewBox={`0 0 ${trend.length*50} 100`} style={{width:"100%",height:100,overflow:"visible"}}>
                            {[0,25,50,75,100].map(y=>(
                              <line key={y} x1={0} y1={100-(y)} x2={trend.length*50} y2={100-(y)} stroke="rgba(11,31,58,0.08)" strokeWidth={1}/>
                            ))}
                            <polyline
                              points={trend.map((d,i)=>`${i*50+25},${100-(d.score)}`).join(" ")}
                              fill="none" stroke="var(--accent-teal)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round"
                            />
                            {trend.map((d,i)=>(
                              <g key={i}>
                                <circle cx={i*50+25} cy={100-d.score} r={5} fill="var(--accent-teal)" stroke="var(--bg-card)" strokeWidth={2}/>
                                <text x={i*50+25} y={100-d.score-10} textAnchor="middle" fontSize="10" fill="var(--accent-teal)" fontWeight="700">{d.score}%</text>
                              </g>
                            ))}
                          </svg>
                          <div style={{display:"flex",justifyContent:"space-around",marginTop:4}}>
                            {trend.map((d,i)=><div key={i} style={{fontSize:9,color:"var(--text-muted)",textAlign:"center",flex:1}}>{d.name}</div>)}
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {/* Score distribution */}
                  <div className="card" style={{marginBottom:0}}>
                    <div style={{fontWeight:600,marginBottom:16}}>🎯 Score Distribution</div>
                    {(() => {
                      const bands = [
                        {label:"90-100%",min:90,max:101,color:"var(--accent-teal)"},
                        {label:"70-89%",min:70,max:90,color:"#1D3A66"},
                        {label:"50-69%",min:50,max:70,color:"var(--accent-amber)"},
                        {label:"<50%",min:0,max:50,color:"var(--accent-rose)"},
                      ];
                      const total = graded.length;
                      return bands.map(band=>{
                        const count = graded.filter(a=>{
                          const p=(a.obtainedMarks/a.totalMarks)*100;
                          return p>=band.min && p<band.max;
                        }).length;
                        const pct = total ? Math.round(count/total*100) : 0;
                        return (
                          <div key={band.label} style={{marginBottom:10}}>
                            <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:3}}>
                              <span style={{color:"var(--text-secondary)"}}>{band.label}</span>
                              <span style={{fontWeight:600,color:band.color}}>{count} assignment{count!==1?"s":""}</span>
                            </div>
                            <div style={{height:8,background:"var(--bg-secondary)",borderRadius:4,overflow:"hidden"}}>
                              <div style={{width:`${pct}%`,height:"100%",background:band.color,borderRadius:4,transition:"width 0.6s ease"}}/>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>

                {/* All graded assignments detail */}
                <div className="card">
                  <div style={{fontWeight:600,marginBottom:16}}>📋 All Graded Assignments</div>
                  {graded.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).map(a => {
                    const pct = Math.round((a.obtainedMarks/a.totalMarks)*100);
                    const col = pct>=80?"var(--accent-teal)":pct>=60?"var(--accent-amber)":"var(--accent-rose)";
                    return (
                      <div key={a.id} style={{marginBottom:18,paddingBottom:18,borderBottom:"1px solid var(--border)"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                          <div>
                            <div style={{fontWeight:600,fontSize:14}}>{a.title}</div>
                            {a.subject && <div style={{fontSize:12,color:"var(--text-muted)"}}>{a.subject}</div>}
                          </div>
                          <div style={{textAlign:"right",flexShrink:0,marginLeft:12}}>
                            <div style={{fontSize:20,fontWeight:800,color:col}}>{pct}%</div>
                            <div style={{fontSize:11,color:"var(--text-muted)"}}>{a.obtainedMarks}/{a.totalMarks}</div>
                          </div>
                        </div>
                        <div className="progress-bar" style={{marginBottom:6}}>
                          <div className="progress-fill" style={{width:`${pct}%`,background:col}}/>
                        </div>
                        {a.feedback && <div style={{fontSize:12,color:"var(--text-secondary)",marginTop:6,padding:"6px 10px",background:"var(--bg-secondary)",borderRadius:6}}>💬 {a.feedback}</div>}
                      </div>
                    );
                  })}
                </div>
              </>
            }
          </>
        )}

        {/* MESSAGES */}
        {page === "messages" && (
          <>
            <div className="page-header"><h1>Messages</h1><p>Chat directly with your tutor</p></div>
            <div className="card" style={{ padding: 0, height: "70vh", overflow: "hidden" }}>
              <ChatWindow myUid={currentUser.uid} otherUid={tutorInfo?.uid} otherName={tutorInfo?.name} myName={userProfile.name} otherEmail={tutorInfo?.email} />
            </div>
          </>
        )}

        {/* PACKAGES */}
        {page === "packages" && (
          <>
            <div className="page-header"><h1>Class Packages</h1><p>Track your prepaid class block</p></div>

            {packages.length === 0
              ? <div className="card"><div className="empty-state"><div className="empty-icon">🎟️</div><p>No active packages yet.</p></div></div>
              : packages.map(pkg => {
                const usedSessions = sessions.filter(s => s.packageId === pkg.id && s.status === "completed");
                const used = usedSessions.length;
                const remaining = pkg.totalClasses - used;
                const pct = Math.min(100, Math.round((used / pkg.totalClasses) * 100));
                const allPkgSessions = sessions.filter(s => s.packageId === pkg.id).sort((a,b) => (a.utcTimestamp||0) - (b.utcTimestamp||0));
                const isLow = remaining <= 3 && remaining > 0;
                const isDone = remaining <= 0;

                return (
                  <div key={pkg.id} className="card" style={{marginBottom:20}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                      <div>
                        <div style={{fontWeight:700,fontSize:18,marginBottom:4}}>{pkg.name}</div>
                        {pkg.note && pkg.note.split("\n").map((line, i) => (
                          <div key={i} style={{fontSize:12,color:"var(--text-muted)",marginTop:4}}>💬 {line}</div>
                        ))}
                      </div>
                      {isDone
                        ? <span className="badge badge-rose">Package Complete</span>
                        : isLow
                        ? <span className="badge badge-amber">⚠️ {remaining} left</span>
                        : <span className="badge badge-green">{remaining} left</span>
                      }
                    </div>

                    <div style={{marginBottom:8,display:"flex",justifyContent:"space-between",fontSize:13}}>
                      <span style={{color:"var(--text-secondary)"}}>{used} of {pkg.totalClasses} classes used</span>
                      <span style={{fontWeight:600,color:"var(--accent-teal)"}}>{pct}%</span>
                    </div>
                    <div className="progress-bar" style={{height:10,marginBottom:20}}>
                      <div className="progress-fill" style={{width:`${pct}%`,background: isDone ? "var(--accent-rose)" : isLow ? "var(--accent-amber)" : "var(--accent-teal)"}}></div>
                    </div>

                    {allPkgSessions.length > 0 && (
                      <div style={{borderTop:"1px solid var(--border)",paddingTop:16}}>
                        <div style={{fontSize:12,fontWeight:600,color:"var(--text-muted)",marginBottom:10,textTransform:"uppercase",letterSpacing:"0.5px"}}>Session Log</div>
                        <div style={{display:"flex",flexDirection:"column",gap:8}}>
                          {allPkgSessions.map(s => (
                            <div key={s.id} style={{display:"flex",alignItems:"center",gap:10,fontSize:13}}>
                              <span style={{fontSize:16}}>{s.status==="completed" ? "☑️" : "☐"}</span>
                              <span style={{color:"var(--text-secondary)",minWidth:90}}>{s.date}</span>
                              {s.studentId !== currentUser.uid && <span className="badge badge-blue" style={{flexShrink:0}}>{s.studentName}</span>}
                              <span style={{flex:1,color:"var(--text-primary)"}}>{s.topic}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            }
          </>
        )}

        {/* STUDY MATERIALS */}
        {page === "materials" && (
          <>
            <div className="page-header"><h1>Study Materials</h1><p>Files uploaded by your tutor</p></div>
            {materials.length === 0
              ? <div className="card"><div className="empty-state"><div className="empty-icon">📚</div><p>No materials yet. Your tutor will upload files here.</p></div></div>
              : <div className="grid-2">
                {materials.map(m => {
                  const isImage = m.fileType?.startsWith("image/");
                  const isPdf = m.fileType === "application/pdf";
                  const isVideo = m.fileType?.startsWith("video/");
                  const icon = isImage ? "🖼️" : isPdf ? "📄" : isVideo ? "🎬" : "📎";
                  return (
                    <div key={m.id} className="card" style={{marginBottom:0}}>
                      <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                        <div style={{fontSize:36,flexShrink:0}}>{icon}</div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:600,fontSize:15,marginBottom:4}}>{m.title}</div>
                          {m.description && <div style={{fontSize:13,color:"var(--text-secondary)",marginBottom:8}}>{m.description}</div>}
                          <div style={{fontSize:12,color:"var(--text-muted)",marginBottom:12}}>{m.fileName}</div>
                          {isImage && (
                            <img src={m.fileUrl} alt={m.title} style={{width:"100%",borderRadius:8,marginBottom:10,maxHeight:160,objectFit:"cover"}} />
                          )}
                          <a href={m.fileUrl} download={m.fileName}
                            style={{display:"inline-flex",alignItems:"center",gap:6,padding:"8px 16px",background:"rgba(61,142,240,0.1)",borderRadius:6,fontSize:13,color:"var(--accent-blue)",textDecoration:"none",fontWeight:500}}>
                            ⬇️ Download
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            }
          </>
        )}

        {/* PAYMENTS */}
        {page === "payments" && (
          <>
            <div className="page-header"><h1>Payments</h1><p>Your invoices and payment history</p></div>
            {invoices.length === 0
              ? <div className="card"><div className="empty-state"><div className="empty-icon">💳</div><p>No invoices yet. Your tutor will send them here.</p></div></div>
              : invoices.map(inv => (
                <div key={inv.id} className="card" style={{marginBottom:16}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div>
                      <div style={{fontWeight:600,fontSize:16,marginBottom:4}}>{inv.month}</div>
                      <div style={{fontSize:22,fontWeight:700,color:"var(--accent-teal)",marginBottom:8}}>{inv.currency}{inv.amount}</div>
                      {inv.notes && <div style={{fontSize:13,color:"var(--text-secondary)"}}>💬 {inv.notes}</div>}
                      {inv.proofName && (
                        <a href={inv.proofUrl} download={inv.proofName} style={{display:"inline-flex",alignItems:"center",gap:6,marginTop:10,padding:"6px 12px",background:"rgba(56,201,176,0.1)",borderRadius:6,fontSize:13,color:"var(--accent-teal)",textDecoration:"none"}}>
                          📄 {inv.proofName} (your uploaded proof)
                        </a>
                      )}
                    </div>
                    <span className={`badge ${inv.status==="paid"?"badge-green":"badge-rose"}`}>{inv.status}</span>
                  </div>
                  {inv.status === "pending" && (
                    <div style={{marginTop:14}}>
                      <button className="btn btn-blue btn-sm" onClick={() => setProofModal(inv)}>Upload Payment Proof</button>
                    </div>
                  )}
                </div>
              ))
            }
          </>
        )}

        {/* NOTIFICATIONS */}
        {page === "notifications" && (
          <>
            <div className="page-header" style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div><h1>Notifications</h1><p>Updates from your tutor</p></div>
              {unread>0 && <button className="btn btn-outline" onClick={markAllRead}>Mark all read</button>}
            </div>
            <div className="card">
              {notifications.length === 0
                ? <div className="empty-state"><div className="empty-icon">🔔</div><p>No notifications yet.</p></div>
                : <div className="activity-feed">{notifications.map(n => (
                  <div key={n.id} className="activity-item" style={{cursor:"pointer",opacity:n.read?0.6:1}} onClick={() => markNotifRead(n.id)}>
                    <div className="activity-dot" style={{background:!n.read?"var(--accent-blue)":"var(--text-muted)",width:10,height:10}}></div>
                    <div style={{flex:1}}>
                      <div className="activity-text" style={{fontWeight:n.read?400:600}}>{n.message}</div>
                      <div className="activity-time">{format(new Date(n.createdAt),"MMM d, yyyy · h:mm a")}</div>
                    </div>
                    {!n.read && <span className="badge badge-blue" style={{flexShrink:0}}>New</span>}
                  </div>
                ))}</div>
              }
            </div>
          </>
        )}
        </div>
      </div>

      {/* MODAL: Cancel Confirmation (Student) */}
      {studentCancel && (
        <div className="modal-overlay" onClick={() => setStudentCancel(null)}>
          <div className="modal" style={{maxWidth:420}} onClick={e => e.stopPropagation()}>
            <h3>Cancel Session?</h3>
            <p style={{fontSize:14,color:"var(--text-secondary)",margin:"12px 0 20px"}}>
              Are you sure you want to cancel <strong style={{color:"var(--text-primary)"}}>{studentCancel.topic}</strong>?
              <br/><span style={{fontSize:12,color:"var(--text-muted)",marginTop:4,display:"block"}}>{studentCancel.utcTimestamp ? formatInLocal(studentCancel.utcTimestamp) : studentCancel.date}</span>
            </p>
            <p style={{fontSize:13,color:"var(--accent-amber)"}}>⚠️ Your tutor will be notified by email.</p>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setStudentCancel(null)}>Keep Session</button>
              <button className="btn btn-danger" onClick={() => cancelStudentSession(studentCancel)}>Yes, Cancel It</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Book Session */}
      {bookModal && (
        <div className="modal-overlay" onClick={() => { setBookModal(false); setStudentReschedule(null); setSelectedSlot(null); setSelectedDate(null); }}>
          <div className="modal" style={{maxWidth:760, maxHeight:"85vh", overflowY:"auto"}} onClick={e => e.stopPropagation()}>
            <h3>{studentReschedule ? "🔄 Reschedule Session" : "Book a Session"}</h3>
            {studentReschedule && (
              <div style={{background:"rgba(61,142,240,0.08)",border:"1px solid rgba(61,142,240,0.2)",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:13}}>
                Rescheduling: <strong>{studentReschedule.topic}</strong>
                <br/><span style={{color:"var(--text-secondary)"}}>Original: {studentReschedule.utcTimestamp ? formatInLocal(studentReschedule.utcTimestamp) : studentReschedule.date}</span>
              </div>
            )}
            <div style={{background:"rgba(56,201,176,0.08)",border:"1px solid rgba(56,201,176,0.2)",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:13}}>
              🌍 This weekly grid shows your tutor's availability already converted to <strong style={{color:"var(--accent-teal)"}}>{localTZ}</strong> (your local time).
            </div>

            {Object.keys(availabilityGrid).length === 0
              ? <div className="empty-state"><div className="empty-icon">🕐</div><p>Your tutor hasn't set any available hours yet.</p></div>
              : <>
                <div style={{marginBottom:6,fontSize:13,fontWeight:600,color:"var(--text-secondary)"}}>Step 1 — Click an available time slot</div>
                <div style={{overflowX:"auto",marginBottom:20}}>
                  <AvailabilityGridViewer
                    availabilityMap={availabilityGrid}
                    selectedSlotKey={selectedSlot?.key}
                    onSlotClick={(slot) => { setSelectedSlot(slot); setSelectedDate(null); }}
                    maxHeight={320}
                  />
                </div>

                {selectedSlot && (() => {
                  // Find upcoming actual calendar dates matching this weekday
                  // Exclude today if the slot's start time (in PKT) has already passed, and exclude any date where this slot is already booked
                  const matchingDates = nextDays.filter(d => {
                    if (d.dayName !== selectedSlot.day) return false;
                    if (hasConflict(d.date, selectedSlot)) return false;
                    if (d.display === "Today") {
                      const slotUtc = pktToUtc(toPktDate(d.date, selectedSlot), selectedSlot.startPKT);
                      return slotUtc > Date.now();
                    }
                    return true;
                  }).slice(0, 6);
                  return (
                    <div className="field">
                      <div style={{marginBottom:6,fontSize:13,fontWeight:600,color:"var(--text-secondary)"}}>
                        Step 2 — Pick which {selectedSlot.day} ({fmt12(selectedSlot.startPKT)}–{fmt12(selectedSlot.endPKT)} your time)
                      </div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                        {matchingDates.length === 0
                          ? <p style={{fontSize:13,color:"var(--accent-rose)"}}>All upcoming {selectedSlot.day}s at this time are already booked. Try another slot.</p>
                          : matchingDates.map(d => (
                          <button key={d.date} onClick={() => setSelectedDate(d)}
                            style={{
                              padding:"8px 14px", borderRadius:8, border:"1px solid",
                              borderColor: selectedDate?.date===d.date ? "var(--accent-blue)" : "var(--border)",
                              background: selectedDate?.date===d.date ? "rgba(61,142,240,0.15)" : "var(--bg-secondary)",
                              color: selectedDate?.date===d.date ? "var(--accent-blue)" : "var(--text-primary)",
                              cursor:"pointer", fontSize:13, fontWeight:500
                            }}>
                            {d.display}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {selectedSlot && selectedDate && (
                  <div style={{padding:"12px 16px", background:"rgba(56,201,176,0.08)", borderRadius:8, fontSize:13, color:"var(--accent-teal)", marginTop:12}}>
                    ✅ Booking {selectedDate.display} at {fmt12(selectedSlot.startPKT)}–{fmt12(selectedSlot.endPKT)} (tutor's time) · {selectedSlot.duration} min
                  </div>
                )}
              </>
            }

            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => { setBookModal(false); setSelectedSlot(null); setSelectedDate(null); }}>Cancel</button>
              {selectedSlot && selectedDate && <button className="btn btn-blue" onClick={bookSession}>Confirm Booking</button>}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Upload Payment Proof */}
      {proofModal && (
        <div className="modal-overlay" onClick={() => { setProofModal(null); setProofFile(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Upload Payment Proof</h3>
            <p style={{fontSize:14,color:"var(--text-secondary)",marginBottom:20}}>
              {proofModal.month} · <strong style={{color:"var(--text-primary)"}}>{proofModal.currency}{proofModal.amount}</strong>
            </p>
            <div className="field">
              <label>Receipt / Screenshot (PDF or Image)</label>
              <div style={{
                border:"2px dashed var(--border)", borderRadius:8, padding:"20px",
                textAlign:"center", cursor:"pointer",
                background: proofFile ? "rgba(56,201,176,0.05)" : "var(--bg-secondary)",
                borderColor: proofFile ? "var(--accent-teal)" : "var(--border)",
              }}
                onClick={() => document.getElementById("proof-upload").click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if(f) setProofFile(f); }}
              >
                <input id="proof-upload" type="file" accept=".pdf,image/*" style={{display:"none"}}
                  onChange={e => { if(e.target.files[0]) setProofFile(e.target.files[0]); }} />
                {proofFile ? (
                  <div>
                    <div style={{fontSize:28,marginBottom:6}}>📄</div>
                    <div style={{fontWeight:600,color:"var(--accent-teal)",fontSize:14}}>{proofFile.name}</div>
                    <button className="btn btn-sm btn-danger" style={{marginTop:10}}
                      onClick={e => { e.stopPropagation(); setProofFile(null); }}>Remove</button>
                  </div>
                ) : (
                  <div>
                    <div style={{fontSize:28,marginBottom:6}}>📎</div>
                    <div style={{fontSize:14,color:"var(--text-secondary)"}}>Click or drag & drop here</div>
                    <div style={{fontSize:12,color:"var(--text-muted)",marginTop:4}}>PDF or image · Max 5MB</div>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => { setProofModal(null); setProofFile(null); }}>Cancel</button>
              <button className="btn btn-blue" onClick={uploadProof} disabled={proofUploading}>
                {proofUploading ? "Uploading..." : "Submit Proof"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Submit */}
      {submitModal && (
        <div className="modal-overlay" onClick={() => { setSubmitModal(null); setPdfFile(null); setSubmitNote(""); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Submit Assignment</h3>
            <p style={{fontSize:14,color:"var(--text-secondary)",marginBottom:20}}>
              Submitting: <strong style={{color:"var(--text-primary)"}}>{submitModal.title}</strong>
            </p>

            {/* Text box */}
            <div className="field">
              <label>Your Answer / Notes</label>
              <textarea
                placeholder="Write your answer, explanation, or any notes for your tutor..."
                value={submitNote}
                onChange={e => setSubmitNote(e.target.value)}
                style={{minHeight:120}}
              />
            </div>

            {/* PDF Upload */}
            <div className="field">
              <label>Upload PDF (optional)</label>
              <div style={{
                border:"2px dashed var(--border)", borderRadius:8,
                padding:"20px", textAlign:"center", cursor:"pointer",
                background: pdfFile ? "rgba(56,201,176,0.05)" : "var(--bg-secondary)",
                borderColor: pdfFile ? "var(--accent-teal)" : "var(--border)",
                transition:"all 0.2s"
              }}
                onClick={() => document.getElementById("pdf-upload").click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if(f?.type==="application/pdf") setPdfFile(f); else toast.error("Only PDF files allowed."); }}
              >
                <input
                  id="pdf-upload" type="file" accept=".pdf"
                  style={{display:"none"}}
                  onChange={e => { const f = e.target.files[0]; if(f) setPdfFile(f); }}
                />
                {pdfFile ? (
                  <div>
                    <div style={{fontSize:28,marginBottom:6}}>📄</div>
                    <div style={{fontWeight:600,color:"var(--accent-teal)",fontSize:14}}>{pdfFile.name}</div>
                    <div style={{fontSize:12,color:"var(--text-secondary)",marginTop:4}}>
                      {(pdfFile.size/1024).toFixed(0)} KB
                    </div>
                    <button className="btn btn-sm btn-danger" style={{marginTop:10}}
                      onClick={e => { e.stopPropagation(); setPdfFile(null); }}>
                      Remove
                    </button>
                  </div>
                ) : (
                  <div>
                    <div style={{fontSize:28,marginBottom:6}}>📎</div>
                    <div style={{fontSize:14,color:"var(--text-secondary)"}}>Click or drag & drop your PDF here</div>
                    <div style={{fontSize:12,color:"var(--text-muted)",marginTop:4}}>PDF files only · Max 5MB</div>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => { setSubmitModal(null); setPdfFile(null); setSubmitNote(""); }}>Cancel</button>
              <button className="btn btn-blue" onClick={submitAssignment} disabled={pdfUploading}>
                {pdfUploading ? "Submitting..." : "Submit Assignment"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
