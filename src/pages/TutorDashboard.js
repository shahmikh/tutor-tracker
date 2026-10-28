import React, { useState, useEffect, useRef } from "react";
import { db } from "../firebase/config";
import { ref, onValue, push, set, remove } from "firebase/database";
import { useAuth } from "../context/AuthContext";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";
import CountUp from "../components/CountUp";
import toast from "react-hot-toast";
import { format } from "date-fns";
import { DAYS, formatInPKT, formatTimePKT, formatInLocal, pktToUtc, getNextDays, getCountdown } from "../utils/timezone";
import { sendEmail } from "../utils/email";
import { uploadFile, deleteFile } from "../utils/storage";
import { ChatWindow, useTotalUnreadMessages, useUnreadCount } from "../components/Chat";
import { AvailabilityGridEditor, AvailabilityGridViewer } from "../components/AvailabilityGrid";

function formatInStudentTZ(timestamp, timezone) {
  if (!timestamp || !timezone) return null;
  try {
    return new Date(timestamp).toLocaleString("en-US", {
      timeZone: timezone,
      weekday: "short", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
      timeZoneName: "short"
    });
  } catch { return null; }
}

function notify(db, uid, message, type = "info") {
  if (!uid) return;
  push(ref(db, `users/${uid}/notifications`), { message, type, read: false, createdAt: Date.now() });
}

const TIME_OPTIONS = [
  "08:00","08:15","08:30","08:45","09:00","09:15","09:30","09:45",
  "10:00","10:15","10:30","10:45","11:00","11:15","11:30","11:45",
  "12:00","12:15","12:30","12:45","13:00","13:15","13:30","13:45",
  "14:00","14:15","14:30","14:45","15:00","15:15","15:30","15:45",
  "16:00","16:15","16:30","16:45","17:00","17:15","17:30","17:45",
  "18:00","18:15","18:30","18:45","19:00","19:15","19:30","19:45",
  "20:00","20:15","20:30","20:45","21:00","21:15","21:30","21:45",
  "22:00","22:15","22:30","22:45","23:00","23:15","23:30","23:45",
  "00:00","00:15","00:30","00:45","01:00"
];

function fmt12(t) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h === 0 || h < 12 ? "AM" : "PM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2,"0")} ${ampm}`;
}

export default function TutorDashboard() {
  const { currentUser, userProfile } = useAuth();
  const [page, setPage] = useState("dashboard");
  const [students, setStudents] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [allUsers, setAllUsers] = useState({});
  const [availability, setAvailability] = useState({});
  const [unread, setUnread] = useState(0);
  const [, setTick] = useState(0);

  const [showAddStudent, setShowAddStudent] = useState(false);
  const [showAddAssignment, setShowAddAssignment] = useState(false);
  const [showAvailModal, setShowAvailModal] = useState(false);
  const [gradeModal, setGradeModal] = useState(null);
  const [gradeForm, setGradeForm] = useState({ marks: "", feedback: "" });
  const [gradePdf, setGradePdf] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [rescheduleSession, setRescheduleSession] = useState(null);
  const [cancelSession, setCancelSession] = useState(null);
  const [scheduleForm, setScheduleForm] = useState({ studentIds: [], date: "", slotKey: "", slotDay: "", slotStartPKT: "", slotEndPKT: "", slotDuration: "", topic: "" });
  const [activeChatStudent, setActiveChatStudent] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({ studentId: "", month: "", amount: "", currency: "$", notes: "" });
  const [packages, setPackages] = useState([]);
  const [showPackageModal, setShowPackageModal] = useState(false);
  const [topUpPackage, setTopUpPackage] = useState(null);
  const [topUpAmount, setTopUpAmount] = useState("8");
  const [topUpNote, setTopUpNote] = useState("");
  const [materials, setMaterials] = useState([]);
  const [showMaterialModal, setShowMaterialModal] = useState(false);
  const [materialForm, setMaterialForm] = useState({ studentId: "all", title: "", description: "" });
  const [materialFile, setMaterialFile] = useState(null);
  const [materialUploading, setMaterialUploading] = useState(false);
  const [packageForm, setPackageForm] = useState({ name: "", studentIds: [], totalClasses: "24", paidDate: "", note: "" });
  const [activePackage, setActivePackage] = useState(null);
  const { total: totalUnreadMessages, counts: unreadByStudent } = useTotalUnreadMessages(currentUser.uid, students.map(s => s.id));
  const [availabilityGrid, setAvailabilityGrid] = useState({});
  const [gridDirty, setGridDirty] = useState(false);
  const gridLoadedRef = useRef(false);

  const [studentEmail, setStudentEmail] = useState("");
  const [assignForm, setAssignForm] = useState({ studentId: "", title: "", subject: "", dueDate: "", description: "", totalMarks: "100" });
  const [assignPdf, setAssignPdf] = useState(null);

  // Availability form state
  const [availDay, setAvailDay] = useState("Monday");
  const [availStart, setAvailStart] = useState("09:00");
  const [availEnd, setAvailEnd] = useState("10:00");
  const [availDuration, setAvailDuration] = useState("50");

  useEffect(() => {
    onValue(ref(db, "users"), snap => setAllUsers(snap.val() || {}));
    onValue(ref(db, `tutors/${currentUser.uid}/students`), snap => {
      const d = snap.val() || {};
      setStudents(Object.entries(d).map(([id, v]) => ({ id, ...v })));
    });
    onValue(ref(db, `tutors/${currentUser.uid}/sessions`), snap => {
      const d = snap.val() || {};
      setSessions(Object.entries(d).map(([id, v]) => ({ id, ...v })).sort((a, b) => (b.utcTimestamp||0) - (a.utcTimestamp||0)));
    });
    onValue(ref(db, `tutors/${currentUser.uid}/assignments`), snap => {
      const d = snap.val() || {};
      setAssignments(Object.entries(d).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.createdAt - a.createdAt));
    });
    onValue(ref(db, `tutors/${currentUser.uid}/availability`), snap => {
      setAvailability(snap.val() || {});
    });
    onValue(ref(db, `tutors/${currentUser.uid}/availabilityGrid`), snap => {
      if (!gridLoadedRef.current) {
        setAvailabilityGrid(snap.val() || {});
        gridLoadedRef.current = true;
      }
    });
    onValue(ref(db, `users/${currentUser.uid}/notifications`), snap => {
      const d = snap.val() || {};
      const arr = Object.entries(d).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.createdAt - a.createdAt);
      setNotifications(arr);
      setUnread(arr.filter(n => !n.read).length);
    });
    onValue(ref(db, `tutors/${currentUser.uid}/invoices`), snap => {
      const d = snap.val() || {};
      setInvoices(Object.entries(d).map(([id, v]) => ({ id, ...v })).sort((a,b) => b.createdAt - a.createdAt));
    });
    onValue(ref(db, `tutors/${currentUser.uid}/packages`), snap => {
      const d = snap.val() || {};
      setPackages(Object.entries(d).map(([id, v]) => ({ id, ...v })).sort((a,b) => b.createdAt - a.createdAt));
    });
    onValue(ref(db, `tutors/${currentUser.uid}/materials`), snap => {
      const d = snap.val() || {};
      setMaterials(Object.entries(d).map(([id, v]) => ({ id, ...v })).sort((a,b) => b.createdAt - a.createdAt));
    });
  }, [currentUser.uid]);

  // Refresh countdown timers every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  const createInvoice = async () => {
    const { studentId, month, amount, currency, notes } = invoiceForm;
    if (!studentId || !month || !amount) { toast.error("Please fill student, month and amount."); return; }
    const student = students.find(s => s.id === studentId);
    const data = {
      studentId, studentName: student?.name, month, amount, currency, notes,
      status: "pending", proofUrl: null, proofName: null,
      createdAt: Date.now()
    };
    const newRef = push(ref(db, `tutors/${currentUser.uid}/invoices`));
    await set(newRef, data);
    await set(ref(db, `students/${studentId}/invoices/${newRef.key}`), { ...data, tutorInvoicePath: `tutors/${currentUser.uid}/invoices/${newRef.key}` });
    notify(db, studentId, `New invoice for ${month}: ${currency}${amount} 💳`, "invoice");
    if (student?.email) sendEmail(student.email, student.name,
      `Invoice for ${month} 💳`,
      `Hi ${student.name},\n\nYour tutor ${userProfile.name} has created an invoice.\n\nMonth: ${month}\nAmount: ${currency}${amount}\n${notes ? `Notes: ${notes}\n` : ""}\nLog in to Shahmikh Classroom to view details and upload your payment proof.`
    );
    toast.success("Invoice created!");
    setInvoiceForm({ studentId: "", month: "", amount: "", currency: "$", notes: "" });
    setShowInvoiceModal(false);
  };

  const createPackage = async () => {
    const { name, studentIds, totalClasses, paidDate, note } = packageForm;
    if (!name.trim() || studentIds.length === 0 || !totalClasses) {
      toast.error("Please fill package name, students, and total classes."); return;
    }
    const data = {
      name, studentIds, totalClasses: parseInt(totalClasses),
      paidDate: paidDate || null, note,
      status: "active", createdAt: Date.now()
    };
    const newRef = push(ref(db, `tutors/${currentUser.uid}/packages`));
    await set(newRef, data);

    // Link package reference to each student so they can see it
    for (const sid of studentIds) {
      await set(ref(db, `students/${sid}/packages/${newRef.key}`), {
        ...data, tutorPackagePath: `tutors/${currentUser.uid}/packages/${newRef.key}`
      });
      notify(db, sid, `New class package created: "${name}" — ${totalClasses} classes 🎟️`, "package");
      const stu = students.find(s => s.id === sid);
      if (stu?.email) sendEmail(stu.email, stu.name,
        `New Class Package: ${name} 🎟️`,
        `Hi ${stu.name},\n\nA new class package has been set up for you${studentIds.length > 1 ? " (shared)" : ""}.\n\nPackage: ${name}\nTotal Classes: ${totalClasses}\n${note ? `Note: ${note}\n` : ""}\nLog in to Shahmikh Classroom to track classes remaining.`
      );
    }

    toast.success("Package created!");
    setPackageForm({ name: "", studentIds: [], totalClasses: "24", paidDate: "", note: "" });
    setShowPackageModal(false);
  };

  const addClassesToPackage = async () => {
    const extra = parseInt(topUpAmount);
    if (!extra || extra < 1) { toast.error("Enter a valid number of classes."); return; }
    const pkg = topUpPackage;
    const newTotal = pkg.totalClasses + extra;
    const updatedNote = topUpNote.trim()
      ? (pkg.note ? `${pkg.note}\n${topUpNote.trim()}` : topUpNote.trim())
      : pkg.note;

    await set(ref(db, `tutors/${currentUser.uid}/packages/${pkg.id}/totalClasses`), newTotal);
    if (updatedNote !== undefined) await set(ref(db, `tutors/${currentUser.uid}/packages/${pkg.id}/note`), updatedNote);
    for (const sid of pkg.studentIds) {
      await set(ref(db, `students/${sid}/packages/${pkg.id}/totalClasses`), newTotal);
      if (updatedNote !== undefined) await set(ref(db, `students/${sid}/packages/${pkg.id}/note`), updatedNote);
      notify(db, sid, `${extra} classes added to package "${pkg.name}" — now ${newTotal} total 🎟️`, "package");
      const stu = students.find(s => s.id === sid);
      if (stu?.email) sendEmail(stu.email, stu.name,
        `Classes Added to ${pkg.name} 🎟️`,
        `Hi ${stu.name},\n\n${extra} more classes have been added to your package "${pkg.name}".\n\nNew Total: ${newTotal} classes\n${topUpNote.trim() ? `Note: ${topUpNote.trim()}\n` : ""}\nLog in to Shahmikh Classroom to see your updated package.`
      );
    }
    toast.success(`${extra} classes added! New total: ${newTotal}`);
    setTopUpPackage(null);
    setTopUpAmount("8");
    setTopUpNote("");
  };

  // Count how many sessions (for these students) have been completed against a package's creation date
  const getPackageUsage = (pkg) => {
    // Get unique sessions for this package — a shared session counts as 1 class,
    // not 1 per student. We deduplicate by session ID.
    const usedSessions = sessions.filter(s =>
      s.status === "completed" &&
      s.packageId === pkg.id
    );
    // Deduplicate by session ID (shared sessions appear once in tutor's sessions list anyway)
    const uniqueIds = [...new Set(usedSessions.map(s => s.id))];
    const uniqueUsed = uniqueIds.length;
    return {
      used: uniqueUsed,
      remaining: pkg.totalClasses - uniqueUsed,
      sessions: usedSessions.filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i)
    };
  };

  const saveAvailabilityGrid = async () => {
    await set(ref(db, `tutors/${currentUser.uid}/availabilityGrid`), availabilityGrid);
    await set(ref(db, `availabilityGrid/${currentUser.uid}`), availabilityGrid);
    setGridDirty(false);
    toast.success("Availability saved! Students can now book from these hours.");
  };

  const addAvailability = async () => {
    if (availStart >= availEnd) { toast.error("End time must be after start time."); return; }
    const slot = { day: availDay, startPKT: availStart, endPKT: availEnd, duration: parseInt(availDuration) };
    const newRef = push(ref(db, `tutors/${currentUser.uid}/availability`));
    await set(newRef, slot);
    // Also publish to a public path so students can read it
    await set(ref(db, `availability/${currentUser.uid}/${newRef.key}`), slot);
    toast.success("Timeslot added!");
    setShowAvailModal(false);
  };

  const removeAvailability = async (id) => {
    await remove(ref(db, `tutors/${currentUser.uid}/availability/${id}`));
    await remove(ref(db, `availability/${currentUser.uid}/${id}`));
    toast.success("Timeslot removed.");
  };

  // Checks if a given date+slot overlaps with any existing booked session (any student)
  const hasScheduleConflict = (date, startPKT, endPKT) => {
    const newStart = pktToUtc(date, startPKT);
    const newEnd = pktToUtc(date, endPKT);
    return sessions.some(s => {
      if (!s.utcTimestamp || s.status === "cancelled") return false;
      const existingStart = s.utcTimestamp;
      const existingEnd = existingStart + (s.duration || 50) * 60000;
      return newStart < existingEnd && newEnd > existingStart;
    });
  };

  const scheduleSession = async () => {
    const { studentIds, date, slotDay, slotStartPKT, slotEndPKT, slotDuration, topic } = scheduleForm;
    if (!studentIds.length || !date || !slotDay || !topic.trim()) {
      toast.error("Please fill all fields."); return;
    }
    if (hasScheduleConflict(date, slotStartPKT, slotEndPKT)) {
      toast.error("This slot conflicts with an existing session. Please pick another time.");
      return;
    }

    const utcTimestamp = pktToUtc(date, slotStartPKT);
    const isShared = studentIds.length > 1;

    // Find the shared package that includes ALL selected students (or individual package)
    const activePkg = packages.find(p =>
      p.status === "active" &&
      studentIds.every(sid => p.studentIds.includes(sid))
    ) || packages.find(p =>
      p.status === "active" &&
      studentIds.some(sid => p.studentIds.includes(sid))
    );

    const newRef = push(ref(db, `tutors/${currentUser.uid}/sessions`));
    const sessionData = {
      topic,
      studentIds,
      studentNames: studentIds.map(sid => students.find(s => s.id === sid)?.name).filter(Boolean),
      // Keep single studentId/studentName for backwards compatibility with existing UI
      studentId: studentIds[0],
      studentName: isShared
        ? studentIds.map(sid => students.find(s => s.id === sid)?.name).filter(Boolean).join(" & ")
        : students.find(s => s.id === studentIds[0])?.name,
      tutorId: currentUser.uid,
      tutorName: userProfile.name,
      utcTimestamp,
      duration: slotDuration,
      slotDay,
      slotStartPKT,
      slotEndPKT,
      date,
      status: "scheduled",
      isShared,
      createdAt: Date.now(),
      ...(activePkg && { packageId: activePkg.id, packageName: activePkg.name })
    };

    await set(newRef, sessionData);

    // Save to each student's sessions
    for (const sid of studentIds) {
      await set(ref(db, `students/${sid}/sessions/${newRef.key}`), sessionData);
      const stu = students.find(s => s.id === sid);
      notify(db, sid, `${userProfile.name} scheduled a session: "${topic}" on ${date} at ${fmt12(slotStartPKT)} PKT 📅`, "session");
      if (stu?.email) sendEmail(stu.email, stu.name,
        `New Session Scheduled: "${topic}" 📅`,
        `Hi ${stu.name},\n\nYour tutor ${userProfile.name} has scheduled a session with you${isShared ? " (shared session)" : ""}.\n\nTopic: ${topic}\nDate: ${date}\nTime (PKT): ${fmt12(slotStartPKT)} – ${fmt12(slotEndPKT)}\nDuration: ${slotDuration} minutes\n\nLog in to Shahmikh Classroom to see the time in your own timezone.`
      );
    }

    toast.success(isShared ? `Shared session scheduled for ${sessionData.studentName}! (counts as 1 class)` : "Session scheduled!");
    setScheduleForm({ studentIds: [], date: "", slotKey: "", slotDay: "", slotStartPKT: "", slotEndPKT: "", slotDuration: "", topic: "" });
    setShowScheduleModal(false);
  };

  const addStudent = async () => {
    const email = studentEmail.trim().toLowerCase();
    if (!email) return;
    const found = Object.entries(allUsers).find(([, u]) => u.email?.toLowerCase() === email && u.role === "student");
    if (!found) { toast.error("No student account found with that email."); return; }
    const [uid, profile] = found;
    await set(ref(db, `tutors/${currentUser.uid}/students/${uid}`), { name: profile.name, email: profile.email, addedAt: Date.now() });
    await set(ref(db, `students/${uid}/tutor`), { uid: currentUser.uid, name: userProfile.name, email: userProfile.email });
    notify(db, uid, `${userProfile.name} has added you as their student. Welcome! 🎓`, "welcome");
    sendEmail(profile.email, profile.name, "Welcome to Shahmikh Classroom 🎓",
      `Hi ${profile.name},\n\nYou have been added as a student by ${userProfile.name} on Shahmikh Classroom.\n\nLog in to see your assignments and book sessions.`
    );
    toast.success(`${profile.name} added!`);
    setStudentEmail(""); setShowAddStudent(false);
  };

  const addAssignment = async () => {
    if (!assignForm.studentId || !assignForm.title || !assignForm.dueDate) { toast.error("Please fill all required fields."); return; }
    const student = students.find(s => s.id === assignForm.studentId);

    let pdfUrl = null;
    let pdfName = null;
    if (assignPdf) {
      pdfUrl = await uploadFile(assignPdf, `assignments/${currentUser.uid}/${Date.now()}_${assignPdf.name}`);
      pdfName = assignPdf.name;
    }

    const data = { ...assignForm, tutorId: currentUser.uid, tutorName: userProfile.name, studentName: student?.name, status: "pending", obtainedMarks: null, feedback: "", createdAt: Date.now(), ...(pdfUrl && { pdfUrl, pdfName }) };
    const newRef = push(ref(db, `tutors/${currentUser.uid}/assignments`));
    await set(newRef, data);
    await set(ref(db, `students/${assignForm.studentId}/assignments/${newRef.key}`), { ...data, assignmentId: newRef.key, tutorAssignmentPath: `tutors/${currentUser.uid}/assignments/${newRef.key}` });
    notify(db, assignForm.studentId, `New assignment: "${assignForm.title}" due ${assignForm.dueDate} 📝`, "assignment");
    const stuData = students.find(s => s.id === assignForm.studentId);
    if (stuData?.email) sendEmail(stuData.email, stuData.name,
      `New Assignment: ${assignForm.title} 📝`,
      `Hi ${stuData.name},\n\nYour tutor ${userProfile.name} has given you a new assignment:\n\nTitle: ${assignForm.title}\nSubject: ${assignForm.subject}\nDue Date: ${assignForm.dueDate}\n\nDescription: ${assignForm.description || "No description provided."}\n\nLog in to Shahmikh Classroom to submit your work.`
    );
    toast.success("Assignment sent!");
    setAssignForm({ studentId: "", title: "", subject: "", dueDate: "", description: "", totalMarks: "100" });
    setAssignPdf(null);
    setShowAddAssignment(false);
  };

  const markSessionDone = async (s) => {
    await set(ref(db, `tutors/${currentUser.uid}/sessions/${s.id}/status`), "completed");
    await set(ref(db, `students/${s.studentId}/sessions/${s.id}/status`), "completed");
    notify(db, s.studentId, `Session "${s.topic}" marked as completed ✅`, "session");
    const stuEntry = students.find(st => st.id === s.studentId);
    if (stuEntry?.email) sendEmail(stuEntry.email, stuEntry.name,
      `Session Completed ✅`,
      `Hi ${stuEntry.name},\n\nYour session "${s.topic}" has been marked as completed by ${userProfile.name}.\n\nLog in to Shahmikh Classroom to view your progress.`
    );
    toast.success("Session marked complete!");
  };

  const uploadMaterial = async () => {
    if (!materialFile) { toast.error("Please select a file."); return; }
    if (!materialForm.title.trim()) { toast.error("Please enter a title."); return; }
    setMaterialUploading(true);
    const fileUrl = await uploadFile(materialFile, `materials/${currentUser.uid}/${Date.now()}_${materialFile.name}`);
    const data = {
      title: materialForm.title,
      description: materialForm.description,
      fileName: materialFile.name,
      fileType: materialFile.type,
      fileUrl,
      studentId: materialForm.studentId,
      tutorId: currentUser.uid,
      createdAt: Date.now()
    };
    const newRef = push(ref(db, `tutors/${currentUser.uid}/materials`));
    await set(newRef, data);
    const targets = materialForm.studentId === "all" ? students.map(s => s.id) : [materialForm.studentId];
    for (const sid of targets) {
      await set(ref(db, `students/${sid}/materials/${newRef.key}`), { ...data, materialId: newRef.key });
      notify(db, sid, `New study material uploaded: "${materialForm.title}" 📚`, "material");
      const stu = students.find(s => s.id === sid);
      if (stu?.email) sendEmail(stu.email, stu.name,
        `New Study Material: ${materialForm.title} 📚`,
        `Hi ${stu.name},\n\nYour tutor ${userProfile.name} has uploaded a new study material:\n\nTitle: ${materialForm.title}\n${materialForm.description ? `Description: ${materialForm.description}\n` : ""}File: ${materialFile.name}\n\nLog in to Shahmikh Classroom to download it.`
      );
    }
    toast.success("Material uploaded!");
    setMaterialUploading(false);
    setMaterialForm({ studentId: "all", title: "", description: "" });
    setMaterialFile(null);
    setShowMaterialModal(false);
  };

  const deleteMaterial = async (m) => {
    await remove(ref(db, `tutors/${currentUser.uid}/materials/${m.id}`));
    const targets = m.studentId === "all" ? students.map(s => s.id) : [m.studentId];
    for (const sid of targets) {
      await remove(ref(db, `students/${sid}/materials/${m.id}`));
    }
    toast.success("Material deleted.");
  };

  const cancelSessionFn = async (s) => {
    await set(ref(db, `tutors/${currentUser.uid}/sessions/${s.id}/status`), "cancelled");
    const affectedStudentIds = s.studentIds || [s.studentId];
    for (const sid of affectedStudentIds) {
      await set(ref(db, `students/${sid}/sessions/${s.id}/status`), "cancelled");
      notify(db, sid, `Session "${s.topic}" on ${s.date} has been cancelled ❌`, "session");
      const stuEntry = students.find(st => st.id === sid);
      if (stuEntry?.email) sendEmail(stuEntry.email, stuEntry.name,
        `Session Cancelled ❌`,
        `Hi ${stuEntry.name},\n\nYour tutor ${userProfile.name} has cancelled the session:\n\nTopic: ${s.topic}\nOriginal Time (PKT): ${s.utcTimestamp ? formatInPKT(s.utcTimestamp) : s.date}\n\nPlease log in to Shahmikh Classroom to book a new session.`
      );
    }
    toast.success("Session cancelled.");
    setCancelSession(null);
  };

  const doReschedule = async () => {
    const s = rescheduleSession;
    const { date, slotDay, slotStartPKT, slotEndPKT, slotDuration } = scheduleForm;
    if (!date || !slotDay) { toast.error("Please pick a new date and time."); return; }
    const utcTimestamp = pktToUtc(date, slotStartPKT);
    const updatedFields = { date, slotDay, slotStartPKT, slotEndPKT, slotDuration, utcTimestamp, status: "scheduled" };
    const affectedStudentIds = s.studentIds || [s.studentId];
    Object.entries(updatedFields).forEach(([k, v]) => {
      set(ref(db, `tutors/${currentUser.uid}/sessions/${s.id}/${k}`), v);
      affectedStudentIds.forEach(sid => set(ref(db, `students/${sid}/sessions/${s.id}/${k}`), v));
    });
    for (const sid of affectedStudentIds) {
      notify(db, sid, `Session "${s.topic}" has been rescheduled to ${formatInPKT(utcTimestamp)} 🔄`, "session");
      const stuEntry = students.find(st => st.id === sid);
      if (stuEntry?.email) sendEmail(stuEntry.email, stuEntry.name,
        `Session Rescheduled 🔄`,
        `Hi ${stuEntry.name},\n\nYour tutor ${userProfile.name} has rescheduled your session:\n\nTopic: ${s.topic}\nNew Time (PKT): ${fmt12(slotStartPKT)} on ${date}\n\nLog in to Shahmikh Classroom to see the updated time in your timezone.`
      );
    }
    toast.success("Session rescheduled!");
    setRescheduleSession(null);
    setScheduleForm({ studentIds: [], date: "", slotKey: "", slotDay: "", slotStartPKT: "", slotEndPKT: "", slotDuration: "", topic: "" });
  };

  const gradeAssignment = async () => {
    const a = gradeModal;
    const marks = parseInt(gradeForm.marks);
    if (isNaN(marks) || marks < 0 || marks > parseInt(a.totalMarks)) {
      toast.error(`Enter valid marks between 0 and ${a.totalMarks}`); return;
    }

    let feedbackPdfUrl = null;
    let feedbackPdfName = null;
    if (gradePdf) {
      feedbackPdfUrl = await uploadFile(gradePdf, `feedback/${currentUser.uid}/${Date.now()}_${gradePdf.name}`);
      feedbackPdfName = gradePdf.name;
    }

    const gradeData = {
      obtainedMarks: marks,
      feedback: gradeForm.feedback,
      status: "graded",
      ...(feedbackPdfUrl && { feedbackPdfUrl, feedbackPdfName })
    };

    await set(ref(db, `tutors/${currentUser.uid}/assignments/${a.id}/obtainedMarks`), marks);
    await set(ref(db, `tutors/${currentUser.uid}/assignments/${a.id}/feedback`), gradeForm.feedback);
    await set(ref(db, `tutors/${currentUser.uid}/assignments/${a.id}/status`), "graded");
    await set(ref(db, `students/${a.studentId}/assignments/${a.id}/obtainedMarks`), marks);
    await set(ref(db, `students/${a.studentId}/assignments/${a.id}/feedback`), gradeForm.feedback);
    await set(ref(db, `students/${a.studentId}/assignments/${a.id}/status`), "graded");
    if (feedbackPdfUrl) {
      await set(ref(db, `tutors/${currentUser.uid}/assignments/${a.id}/feedbackPdfUrl`), feedbackPdfUrl);
      await set(ref(db, `tutors/${currentUser.uid}/assignments/${a.id}/feedbackPdfName`), feedbackPdfName);
      await set(ref(db, `students/${a.studentId}/assignments/${a.id}/feedbackPdfUrl`), feedbackPdfUrl);
      await set(ref(db, `students/${a.studentId}/assignments/${a.id}/feedbackPdfName`), feedbackPdfName);
    }

    notify(db, a.studentId, `Your assignment "${a.title}" has been graded: ${marks}/${a.totalMarks} 🎯`, "grade");
    const stu = students.find(s => s.id === a.studentId);
    if (stu?.email) sendEmail(stu.email, stu.name,
      `Assignment Graded: ${a.title} 🎯`,
      `Hi ${stu.name},\n\nYour assignment "${a.title}" has been graded!\n\nScore: ${marks}/${a.totalMarks}\n${gradeForm.feedback ? `Feedback: ${gradeForm.feedback}` : ""}${feedbackPdfName ? `\n\nYour tutor attached a feedback PDF. Log in to download it.` : ""}\n\nLog in to Shahmikh Classroom to view your progress.`
    );
    toast.success("Assignment graded!");
    setGradeModal(null); setGradeForm({ marks: "", feedback: "" }); setGradePdf(null);
  };

  const markNotifRead = (nid) => set(ref(db, `users/${currentUser.uid}/notifications/${nid}/read`), true);
  const markAllRead = () => notifications.forEach(n => { if (!n.read) markNotifRead(n.id); });

  const completedSessions = sessions.filter(s => s.status === "completed").length;
  const pendingAssign = assignments.filter(a => a.status === "pending").length;
  const upcomingSessions = sessions.filter(s => s.status === "scheduled");

  // Group availability by day
  const availByDay = {};
  Object.entries(availability).forEach(([id, slot]) => {
    if (!availByDay[slot.day]) availByDay[slot.day] = [];
    availByDay[slot.day].push({ id, ...slot });
  });

  return (
    <div className="app-layout">
      <Sidebar active={page} onNav={setPage} unreadCount={unread} unreadMessages={totalUnreadMessages} />
      <div className="main-content">
        <Topbar page={page} onNav={setPage} unreadCount={unread} unreadMessages={totalUnreadMessages} />
        <div className="page-body">

        {/* DASHBOARD */}
        {page === "dashboard" && (
          <>
            <div className="page-header">
              <h1>Good day, {userProfile?.name?.split(" ")[0]}</h1>
              <p>Your teaching overview · All times shown in <strong style={{color:"var(--accent-teal)"}}>PKT (Pakistan Time)</strong></p>
            </div>

            {packages.filter(p => {
              const { remaining } = getPackageUsage(p);
              return remaining <= 3 && remaining > 0;
            }).map(p => {
              const { remaining } = getPackageUsage(p);
              return (
                <div key={p.id} className="card" style={{background:"rgba(240,165,0,0.08)",border:"1px solid rgba(240,165,0,0.3)",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{display:"flex",alignItems:"center",gap:12}}>
                    <span style={{fontSize:24}}>⚠️</span>
                    <div>
                      <div style={{fontWeight:600,fontSize:14}}>{p.name} has only {remaining} class{remaining!==1?"es":""} left</div>
                      <div style={{fontSize:12,color:"var(--text-secondary)"}}>Time to renew this package?</div>
                    </div>
                  </div>
                  <button className="btn btn-sm btn-outline" onClick={() => setPage("packages")}>View</button>
                </div>
              );
            })}

            {(() => {
              const next = [...upcomingSessions].filter(x => (x.utcTimestamp||0) > Date.now()-3600000).sort((a,b) => (a.utcTimestamp||0) - (b.utcTimestamp||0))[0];
              return (
                <div className="hero-card">
                  <div style={{position:"relative",zIndex:1}}>
                    <div className="eyebrow">{next ? "Next lesson" : "You're all clear"}</div>
                    <h2>{next ? next.topic : "No lessons scheduled"}</h2>
                    <p>{next ? `with ${next.studentName} · ${next.utcTimestamp ? formatInPKT(next.utcTimestamp) : next.date}` : "Schedule a lesson with one of your students."}</p>
                    {next && next.utcTimestamp && <div className="countdown"><span className="live"></span>Starts {getCountdown(next.utcTimestamp)}</div>}
                  </div>
                  <div className="cta">
                    <button className="btn-hero" onClick={() => setPage("sessions")}>{next ? "Open lessons" : "Schedule a lesson"}</button>
                    <button className="btn-hero ghost" onClick={() => setPage("students")}>My students</button>
                  </div>
                </div>
              );
            })()}

            <div className="stats-row">
              <div className="stat-card"><div className="stat-label">Students</div><div className="stat-value color-blue"><CountUp value={students.length} /></div><div className="stat-sub">Active learners</div></div>
              <div className="stat-card"><div className="stat-label">Sessions</div><div className="stat-value color-teal"><CountUp value={completedSessions} /></div><div className="stat-sub">Completed</div></div>
              <div className="stat-card"><div className="stat-label">Assignments</div><div className="stat-value color-amber"><CountUp value={assignments.length} /></div><div className="stat-sub">Total given</div></div>
              <div className="stat-card"><div className="stat-label">Pending</div><div className="stat-value color-rose"><CountUp value={pendingAssign} /></div><div className="stat-sub">Awaiting submission</div></div>
            </div>
            <div className="grid-2">
              <div className="card">
                <div className="card-header"><h3>Upcoming Sessions</h3></div>
                {upcomingSessions.length === 0
                  ? <div className="empty-state"><div className="empty-icon">📅</div><p>No upcoming sessions</p></div>
                  : <table className="data-table"><thead><tr><th>Topic</th><th>Student</th><th>Your Time (PKT)</th><th>Student's Time</th><th>Starts</th><th></th></tr></thead>
                    <tbody>{[...upcomingSessions].sort((a,b) => (a.utcTimestamp||0) - (b.utcTimestamp||0)).slice(0,5).map(s => {
                      const stuLocal = s.utcTimestamp && s.studentTimezone ? formatInStudentTZ(s.utcTimestamp, s.studentTimezone) : null;
                      return (
                      <tr key={s.id}>
                        <td>{s.topic}</td>
                        <td><span className="badge badge-blue">{s.studentName}</span></td>
                        <td style={{color:"var(--text-secondary)",fontSize:12}}>{s.utcTimestamp ? formatInPKT(s.utcTimestamp) : `${s.date} ${s.time}`}</td>
                        <td style={{fontSize:12,color:"var(--accent-teal)"}}>{stuLocal || "—"}</td>
                        <td style={{fontSize:12,color:"var(--accent-teal)",fontWeight:600}}>{s.utcTimestamp ? getCountdown(s.utcTimestamp) : "—"}</td>
                        <td><button className="btn btn-sm btn-outline" onClick={() => markSessionDone(s)}>Done</button></td>
                      </tr>
                      );
                    })}</tbody>
                  </table>
                }
              </div>
              <div className="card">
                <div className="card-header"><h3>Recent Activity</h3></div>
                {notifications.length === 0
                  ? <div className="empty-state"><div className="empty-icon">🔔</div><p>No activity yet</p></div>
                  : <div className="activity-feed">{notifications.slice(0,6).map(n => (
                    <div key={n.id} className="activity-item">
                      <div className="activity-dot" style={{background: n.type==="assignment"?"#C98A00":n.type==="session"?"#1D3A66":"#1E9E6A"}}></div>
                      <div><div className="activity-text">{n.message}</div><div className="activity-time">{format(new Date(n.createdAt),"MMM d, h:mm a")}</div></div>
                    </div>
                  ))}</div>
                }
              </div>
            </div>
          </>
        )}

        {/* AVAILABILITY */}
        {page === "availability" && (
          <>
            <div className="page-header" style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <h1>My Availability</h1>
                <p>Click and drag on the grid to mark when you're free, in <strong style={{color:"var(--accent-teal)"}}>Pakistan Time (PKT)</strong>. Students automatically see 50-min bookable slots, converted to their own timezone.</p>
              </div>
              <div style={{display:"flex",gap:10}}>
                {gridDirty && <button className="btn btn-blue" onClick={saveAvailabilityGrid}>💾 Save Changes</button>}
                <button className="btn btn-outline" onClick={() => { setAvailabilityGrid({}); setGridDirty(true); }}>Clear All</button>
              </div>
            </div>

            <div className="card" style={{marginBottom:16,padding:"12px 16px",display:"flex",alignItems:"center",gap:10,background:"rgba(61,142,240,0.06)",border:"1px solid rgba(61,142,240,0.2)"}}>
              <span style={{fontSize:18}}>🖱️</span>
              <span style={{fontSize:13,color:"var(--text-secondary)"}}>Click a cell to toggle it on/off, or click-and-drag across multiple cells to paint a whole range at once.</span>
            </div>

            <div style={{overflowX:"auto"}}>
              <AvailabilityGridEditor value={availabilityGrid} onChange={(updater) => { setAvailabilityGrid(updater); setGridDirty(true); }} maxHeight={560} />
            </div>

            <div className="card" style={{marginTop:20,background:"rgba(56,201,176,0.05)", border:"1px solid rgba(56,201,176,0.2)"}}>
              <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                <div style={{fontSize:24}}>🌍</div>
                <div>
                  <div style={{fontWeight:600,marginBottom:4}}>How this works</div>
                  <div style={{fontSize:13,color:"var(--text-secondary)",lineHeight:1.7}}>
                    Paint the hours you're generally free — the app automatically slices each painted block into <strong style={{color:"var(--accent-teal)"}}>50-minute bookable sessions</strong>.<br/>
                    Times are set in <strong style={{color:"var(--accent-teal)"}}>Pakistan Time (PKT, UTC+5)</strong>. Your US students will see the exact same grid converted to their own local time automatically.
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* STUDENTS */}
        {page === "students" && (
          <>
            <div className="page-header" style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div><h1>My Students</h1><p>Manage your learners</p></div>
              <button className="btn btn-blue" onClick={() => setShowAddStudent(true)}>+ Add Student</button>
            </div>
            {students.length === 0
              ? <div className="card"><div className="empty-state"><div className="empty-icon">👥</div><p>No students yet. Add your first student above.</p></div></div>
              : <div className="grid-2">{students.map(s => {
                const stuAssign = assignments.filter(a => a.studentId === s.id);
                const done = stuAssign.filter(a => a.status==="submitted"||a.status==="graded").length;
                const pct = stuAssign.length ? Math.round((done/stuAssign.length)*100) : 0;
                return (
                  <div key={s.id} className="card">
                    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
                      <div className="user-avatar" style={{width:44,height:44,fontSize:18,background:"#1D3A66"}}>{s.name?.charAt(0)?.toUpperCase()}</div>
                      <div><div style={{fontWeight:600}}>{s.name}</div><div style={{fontSize:12,color:"var(--text-secondary)"}}>{s.email}</div></div>
                    </div>
                    <div style={{marginBottom:8,fontSize:12,color:"var(--text-secondary)",display:"flex",justifyContent:"space-between"}}><span>Assignment completion</span><span>{pct}%</span></div>
                    <div className="progress-bar"><div className="progress-fill" style={{width:`${pct}%`,background:"var(--accent-teal)"}}></div></div>
                    <div style={{marginTop:14,display:"flex",gap:8}}>
                      <button className="btn btn-sm btn-blue" onClick={() => { setAssignForm(f=>({...f,studentId:s.id})); setShowAddAssignment(true); }}>Assign</button>
                    </div>
                  </div>
                );
              })}</div>
            }
          </>
        )}

        {/* SESSIONS */}
        {page === "sessions" && (
          <>
            <div className="page-header" style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <h1>Sessions</h1>
                <p>All times shown in <strong style={{color:"var(--accent-teal)"}}>Pakistan Time (PKT)</strong></p>
              </div>
              <button className="btn btn-blue" onClick={() => setShowScheduleModal(true)}>+ Schedule Session</button>
            </div>
            <div className="card">
              {sessions.length === 0
                ? <div className="empty-state"><div className="empty-icon">📅</div><p>No sessions yet. Schedule one or students can book from your availability.</p></div>
                : <table className="data-table"><thead><tr><th>Topic</th><th>Student</th><th>Your Time (PKT)</th><th>Student's Time</th><th>Duration</th><th>Status</th><th></th></tr></thead>
                  <tbody>{sessions.map(s => {
                    const studentLocalTime = s.utcTimestamp && s.studentTimezone ? formatInStudentTZ(s.utcTimestamp, s.studentTimezone) : null;
                    return (
                    <tr key={s.id}>
                      <td style={{fontWeight:500}}>{s.topic}</td>
                      <td>{s.studentName}{s.isShared && <span style={{marginLeft:6,fontSize:10,background:"rgba(56,201,176,0.15)",color:"var(--accent-teal)",padding:"2px 6px",borderRadius:4,fontWeight:600}}>SHARED</span>}</td>
                      <td style={{color:"var(--text-secondary)",fontSize:12}}>{s.utcTimestamp ? formatInPKT(s.utcTimestamp) : `${s.date} ${s.time}`}</td>
                      <td style={{fontSize:12}}>
                        {studentLocalTime
                          ? <span style={{color:"var(--accent-teal)"}}>{studentLocalTime}</span>
                          : <span style={{color:"var(--text-muted)"}}>—</span>
                        }
                      </td>
                      <td style={{color:"var(--text-secondary)"}}>{s.duration} min</td>
                      <td><span className={`badge ${s.status==="completed"?"badge-green":s.status==="cancelled"?"badge-rose":"badge-blue"}`}>{s.status}</span></td>
                      <td>
                        {s.status==="scheduled" && (
                          <div style={{display:"flex",gap:6}}>
                            <button className="btn btn-sm btn-outline" onClick={() => markSessionDone(s)}>✅ Done</button>
                            <button className="btn btn-sm btn-outline" onClick={() => { setRescheduleSession(s); setScheduleForm(f=>({...f,studentIds:s.studentIds||[s.studentId],topic:s.topic,slotKey:"",slotDay:"",date:""})); setShowScheduleModal(true); }}>🔄 Reschedule</button>
                            <button className="btn btn-sm btn-danger" onClick={() => setCancelSession(s)}>❌ Cancel</button>
                          </div>
                        )}
                      </td>
                    </tr>
                    );
                  })}</tbody>
                </table>
              }
            </div>
          </>
        )}

        {/* ASSIGNMENTS */}
        {page === "assignments" && (
          <>
            <div className="page-header" style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <h1>Assignments</h1>
                <p>{selectedStudent ? `Showing assignments for ${selectedStudent.name}` : "Select a student to view their assignments"}</p>
              </div>
              <div style={{display:"flex",gap:10}}>
                {selectedStudent && <button className="btn btn-outline" onClick={() => setSelectedStudent(null)}>← All Students</button>}
                <button className="btn btn-blue" onClick={() => setShowAddAssignment(true)}>+ New Assignment</button>
              </div>
            </div>

            {/* Student selector */}
            {!selectedStudent && (
              <div className="grid-2">
                {students.length === 0
                  ? <div className="card"><div className="empty-state"><div className="empty-icon">👥</div><p>No students yet.</p></div></div>
                  : students.map(s => {
                    const stuAssign = assignments.filter(a => a.studentId === s.id);
                    const pending = stuAssign.filter(a => a.status === "pending").length;
                    const submitted = stuAssign.filter(a => a.status === "submitted").length;
                    const graded = stuAssign.filter(a => a.status === "graded").length;
                    return (
                      <div key={s.id} className="card" style={{cursor:"pointer",transition:"border-color 0.2s"}}
                        onClick={() => setSelectedStudent(s)}
                        onMouseEnter={e => e.currentTarget.style.borderColor="var(--accent-blue)"}
                        onMouseLeave={e => e.currentTarget.style.borderColor="var(--border)"}
                      >
                        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
                          <div className="user-avatar" style={{width:44,height:44,fontSize:18,background:"#1D3A66"}}>{s.name?.charAt(0)?.toUpperCase()}</div>
                          <div><div style={{fontWeight:600,fontSize:16}}>{s.name}</div><div style={{fontSize:12,color:"var(--text-secondary)"}}>{s.email}</div></div>
                        </div>
                        <div style={{display:"flex",gap:12}}>
                          <div style={{flex:1,textAlign:"center",padding:"8px",background:"var(--bg-secondary)",borderRadius:8}}>
                            <div style={{fontSize:20,fontWeight:700,color:"var(--accent-rose)"}}>{pending}</div>
                            <div style={{fontSize:11,color:"var(--text-muted)"}}>Pending</div>
                          </div>
                          <div style={{flex:1,textAlign:"center",padding:"8px",background:"var(--bg-secondary)",borderRadius:8}}>
                            <div style={{fontSize:20,fontWeight:700,color:"var(--accent-amber)"}}>{submitted}</div>
                            <div style={{fontSize:11,color:"var(--text-muted)"}}>Submitted</div>
                          </div>
                          <div style={{flex:1,textAlign:"center",padding:"8px",background:"var(--bg-secondary)",borderRadius:8}}>
                            <div style={{fontSize:20,fontWeight:700,color:"var(--accent-teal)"}}>{graded}</div>
                            <div style={{fontSize:11,color:"var(--text-muted)"}}>Graded</div>
                          </div>
                        </div>
                        {submitted > 0 && (
                          <div style={{marginTop:12,padding:"6px 12px",background:"rgba(240,165,0,0.1)",borderRadius:6,fontSize:12,color:"var(--accent-amber)",fontWeight:600}}>
                            ⚠️ {submitted} assignment{submitted>1?"s":""} waiting to be graded
                          </div>
                        )}
                      </div>
                    );
                  })
                }
              </div>
            )}

            {/* Selected student's assignments */}
            {selectedStudent && (() => {
              const stuAssign = assignments.filter(a => a.studentId === selectedStudent.id);
              return stuAssign.length === 0
                ? <div className="card"><div className="empty-state"><div className="empty-icon">📝</div><p>No assignments given to {selectedStudent.name} yet.</p></div></div>
                : stuAssign.map(a => (
                  <div key={a.id} className="card" style={{marginBottom:16}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div style={{flex:1}}>
                        <div style={{fontWeight:600,fontSize:16,marginBottom:4}}>{a.title}</div>
                        <div style={{fontSize:13,color:"var(--text-secondary)",marginBottom:8}}>
                          {a.subject && `${a.subject} · `}Due: {a.dueDate} · {a.totalMarks} marks
                        </div>
                        {a.description && <div style={{fontSize:13,color:"var(--text-secondary)",marginBottom:8}}>{a.description}</div>}

                        {/* Tutor's original attachment */}
                        {a.pdfName && a.pdfUrl && (
                          <a href={a.pdfUrl} target="_blank" rel="noreferrer"
                            style={{display:"inline-flex",alignItems:"center",gap:6,padding:"5px 10px",background:"rgba(61,142,240,0.1)",borderRadius:6,fontSize:12,color:"var(--accent-blue)",textDecoration:"none",marginBottom:8}}>
                            📄 Your Attachment: {a.pdfName}
                          </a>
                        )}

                        {/* Student submission */}
                        {a.status !== "pending" && (
                          <div style={{marginTop:8,padding:"12px",background:"var(--bg-secondary)",borderRadius:8,border:"1px solid var(--border)"}}>
                            <div style={{fontSize:12,fontWeight:600,color:"var(--text-muted)",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.5px"}}>Student Submission</div>
                            {a.submittedNote && (
                              <div style={{fontSize:13,color:"var(--text-primary)",marginBottom:8,padding:"8px 10px",background:"var(--bg-card)",borderRadius:6}}>
                                💬 {a.submittedNote}
                              </div>
                            )}
                            {a.submissionUrl && a.submissionName && (
                              <a href={a.submissionUrl} target="_blank" rel="noreferrer"
                                style={{display:"inline-flex",alignItems:"center",gap:6,padding:"6px 12px",background:"rgba(56,201,176,0.1)",borderRadius:6,fontSize:12,color:"var(--accent-teal)",textDecoration:"none",fontWeight:500}}>
                                📤 Download Submission: {a.submissionName}
                              </a>
                            )}
                            {!a.submittedNote && !a.submissionUrl && (
                              <div style={{fontSize:13,color:"var(--text-muted)"}}>No note or file submitted.</div>
                            )}
                          </div>
                        )}

                        {/* Tutor feedback after grading */}
                        {a.feedback && (
                          <div style={{marginTop:8,padding:"8px 12px",background:"rgba(56,201,176,0.08)",borderRadius:8,fontSize:13,color:"var(--accent-teal)"}}>
                            ✅ Your feedback: {a.feedback}
                          </div>
                        )}
                        {a.feedbackPdfUrl && a.feedbackPdfName && (
                          <a href={a.feedbackPdfUrl} target="_blank" rel="noreferrer"
                            style={{display:"inline-flex",alignItems:"center",gap:6,marginTop:6,padding:"5px 10px",background:"rgba(56,201,176,0.1)",borderRadius:6,fontSize:12,color:"var(--accent-teal)",textDecoration:"none"}}>
                            📄 Feedback PDF: {a.feedbackPdfName}
                          </a>
                        )}
                      </div>

                      <div style={{textAlign:"right",flexShrink:0,marginLeft:20}}>
                        <span className={`badge ${a.status==="graded"?"badge-green":a.status==="submitted"?"badge-amber":"badge-rose"}`}>{a.status}</span>
                        {a.obtainedMarks!=null && <div style={{fontSize:22,fontWeight:700,color:"var(--accent-teal)",marginTop:8}}>{a.obtainedMarks}<span style={{fontSize:13,color:"var(--text-secondary)"}}>/{a.totalMarks}</span></div>}
                      </div>
                    </div>

                    {/* Grade button — only for submitted assignments */}
                    {a.status === "submitted" && (
                      <div style={{marginTop:14}}>
                        <button className="btn btn-teal" onClick={() => { setGradeModal(a); setGradeForm({marks:"",feedback:""}); }}>
                          ✏️ Grade This Assignment
                        </button>
                      </div>
                    )}
                  </div>
                ));
            })()}
          </>
        )}

        {/* PROGRESS */}
        {page === "progress" && (
          <>
            <div className="page-header"><h1>Progress Overview</h1><p>Performance analytics across all your students</p></div>
            {students.length === 0
              ? <div className="card"><div className="empty-state"><div className="empty-icon">📊</div><p>Add students to track progress.</p></div></div>
              : <>
                {/* Top summary cards */}
                <div className="stats-grid" style={{marginBottom:24}}>
                  <div className="stat-card">
                    <div className="stat-label">Total Sessions</div>
                    <div className="stat-value">{sessions.filter(s=>s.status==="completed").length}</div>
                    <div style={{fontSize:12,color:"var(--text-muted)"}}>completed</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Assignments Given</div>
                    <div className="stat-value">{assignments.length}</div>
                    <div style={{fontSize:12,color:"var(--text-muted)"}}>{assignments.filter(a=>a.status==="graded").length} graded</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Overall Avg Score</div>
                    <div className="stat-value" style={{color:"var(--accent-teal)"}}>
                      {(() => {
                        const graded = assignments.filter(a=>a.status==="graded"&&a.obtainedMarks!=null);
                        return graded.length ? Math.round(graded.reduce((s,a)=>s+(a.obtainedMarks/a.totalMarks)*100,0)/graded.length)+"%" : "—";
                      })()}
                    </div>
                    <div style={{fontSize:12,color:"var(--text-muted)"}}>across all students</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Pending Review</div>
                    <div className="stat-value" style={{color:"var(--accent-amber)"}}>{assignments.filter(a=>a.status==="submitted").length}</div>
                    <div style={{fontSize:12,color:"var(--text-muted)"}}>to grade</div>
                  </div>
                </div>

                {/* Per-student cards */}
                {students.map(stu => {
                  const stuAssign = assignments.filter(a => a.studentId === stu.id);
                  const graded = stuAssign.filter(a => a.status==="graded" && a.obtainedMarks!=null);
                  const avg = graded.length ? Math.round(graded.reduce((sum,a)=>sum+(a.obtainedMarks/a.totalMarks)*100,0)/graded.length) : null;
                  const stuSessions = sessions.filter(s => (s.studentIds||[s.studentId]).includes(stu.id));
                  const completedSess = stuSessions.filter(x=>x.status==="completed").length;
                  const scheduledSess = stuSessions.filter(x=>x.status==="scheduled").length;

                  // Assignment score trend — last 8 graded assignments in order
                  const scoreTrend = graded
                    .sort((a,b)=>(a.createdAt||0)-(b.createdAt||0))
                    .slice(-8)
                    .map((a,i) => ({
                      name: a.title.length>12 ? a.title.slice(0,12)+"…" : a.title,
                      score: Math.round((a.obtainedMarks/a.totalMarks)*100)
                    }));

                  // Sessions per month (last 6 months)
                  const sessPerMonth = {};
                  stuSessions.filter(s=>s.status==="completed" && s.utcTimestamp).forEach(s => {
                    const m = new Date(s.utcTimestamp).toLocaleString("en-US",{month:"short",year:"2-digit"});
                    sessPerMonth[m] = (sessPerMonth[m]||0) + 1;
                  });
                  const sessionChart = Object.entries(sessPerMonth).slice(-6).map(([m,v])=>({month:m,sessions:v}));

                  const avgColor = avg==null?"var(--text-muted)":avg>=80?"var(--accent-teal)":avg>=60?"var(--accent-amber)":"var(--accent-rose)";

                  return (
                    <div key={stu.id} className="card" style={{marginBottom:24}}>
                      {/* Student header */}
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24,flexWrap:"wrap",gap:12}}>
                        <div style={{display:"flex",gap:14,alignItems:"center"}}>
                          <div className="user-avatar" style={{width:48,height:48,fontSize:18,background:"var(--accent-blue)",flexShrink:0}}>{stu.name?.charAt(0)?.toUpperCase()}</div>
                          <div>
                            <div style={{fontWeight:700,fontSize:16}}>{stu.name}</div>
                            <div style={{fontSize:12,color:"var(--text-secondary)",marginTop:2}}>
                              {completedSess} classes done · {scheduledSess} upcoming · {stuAssign.length} assignments
                            </div>
                          </div>
                        </div>
                        {avg!=null && (
                          <div style={{textAlign:"center",padding:"10px 20px",background:"rgba(56,201,176,0.08)",borderRadius:12,border:"1px solid rgba(56,201,176,0.2)"}}>
                            <div style={{fontSize:32,fontWeight:800,color:avgColor,lineHeight:1}}>{avg}%</div>
                            <div style={{fontSize:11,color:"var(--text-muted)",marginTop:2}}>avg score</div>
                          </div>
                        )}
                      </div>

                      {/* Mini stat pills */}
                      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
                        {[
                          {label:"Pending",val:stuAssign.filter(a=>a.status==="pending").length,color:"var(--accent-rose)"},
                          {label:"Submitted",val:stuAssign.filter(a=>a.status==="submitted").length,color:"var(--accent-amber)"},
                          {label:"Graded",val:graded.length,color:"var(--accent-teal)"},
                        ].map(pill=>(
                          <div key={pill.label} style={{padding:"4px 12px",borderRadius:20,background:"var(--bg-secondary)",border:"1px solid var(--border)",fontSize:12,display:"flex",gap:6,alignItems:"center"}}>
                            <span style={{fontWeight:700,color:pill.color}}>{pill.val}</span>
                            <span style={{color:"var(--text-muted)"}}>{pill.label}</span>
                          </div>
                        ))}
                      </div>

                      {/* Charts row */}
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
                        {/* Score trend chart */}
                        <div style={{background:"var(--bg-secondary)",borderRadius:10,padding:"14px 16px",border:"1px solid var(--border)"}}>
                          <div style={{fontSize:12,fontWeight:600,color:"var(--text-secondary)",marginBottom:12}}>📈 Score Trend</div>
                          {scoreTrend.length < 2
                            ? <div style={{fontSize:12,color:"var(--text-muted)",textAlign:"center",padding:"20px 0"}}>Need 2+ graded assignments</div>
                            : (
                              <div style={{position:"relative",height:80}}>
                                {/* Simple SVG line chart */}
                                <svg viewBox={`0 0 ${scoreTrend.length*40} 80`} style={{width:"100%",height:"100%",overflow:"visible"}}>
                                  {/* Grid lines */}
                                  {[0,25,50,75,100].map(y=>(
                                    <line key={y} x1={0} y1={80-(y*80/100)} x2={scoreTrend.length*40} y2={80-(y*80/100)} stroke="rgba(11,31,58,0.08)" strokeWidth={1}/>
                                  ))}
                                  {/* Line */}
                                  <polyline
                                    points={scoreTrend.map((d,i)=>`${i*40+20},${80-(d.score*80/100)}`).join(" ")}
                                    fill="none" stroke="var(--accent-teal)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round"
                                  />
                                  {/* Dots + values */}
                                  {scoreTrend.map((d,i)=>(
                                    <g key={i}>
                                      <circle cx={i*40+20} cy={80-(d.score*80/100)} r={4} fill="var(--accent-teal)" stroke="var(--bg-secondary)" strokeWidth={2}/>
                                      <text x={i*40+20} y={80-(d.score*80/100)-8} textAnchor="middle" fontSize="9" fill="var(--accent-teal)" fontWeight="600">{d.score}%</text>
                                    </g>
                                  ))}
                                </svg>
                                {/* X labels */}
                                <div style={{display:"flex",justifyContent:"space-around",marginTop:4}}>
                                  {scoreTrend.map((d,i)=>(
                                    <div key={i} style={{fontSize:9,color:"var(--text-muted)",textAlign:"center",flex:1}}>{d.name}</div>
                                  ))}
                                </div>
                              </div>
                            )
                          }
                        </div>

                        {/* Sessions per month chart */}
                        <div style={{background:"var(--bg-secondary)",borderRadius:10,padding:"14px 16px",border:"1px solid var(--border)"}}>
                          <div style={{fontSize:12,fontWeight:600,color:"var(--text-secondary)",marginBottom:12}}>📅 Sessions per Month</div>
                          {sessionChart.length === 0
                            ? <div style={{fontSize:12,color:"var(--text-muted)",textAlign:"center",padding:"20px 0"}}>No completed sessions yet</div>
                            : (
                              <div style={{position:"relative",height:80}}>
                                {(() => {
                                  const maxV = Math.max(...sessionChart.map(d=>d.sessions), 1);
                                  const barW = Math.floor(80/sessionChart.length);
                                  return (
                                    <svg viewBox={`0 0 ${sessionChart.length*50} 80`} style={{width:"100%",height:"80px"}}>
                                      {sessionChart.map((d,i)=>{
                                        const bh = Math.round((d.sessions/maxV)*70);
                                        return (
                                          <g key={i}>
                                            <rect x={i*50+8} y={80-bh} width={34} height={bh} rx={4} fill="rgba(61,142,240,0.7)"/>
                                            <text x={i*50+25} y={80-bh-4} textAnchor="middle" fontSize="9" fill="var(--accent-blue)" fontWeight="600">{d.sessions}</text>
                                            <text x={i*50+25} y={80} textAnchor="middle" fontSize="8.5" fill="var(--text-muted)">{d.month}</text>
                                          </g>
                                        );
                                      })}
                                    </svg>
                                  );
                                })()}
                              </div>
                            )
                          }
                        </div>
                      </div>

                      {/* Assignment table */}
                      {stuAssign.length > 0 && (
                        <table className="data-table" style={{fontSize:13}}>
                          <thead><tr><th>Assignment</th><th>Subject</th><th>Status</th><th>Score</th><th>%</th></tr></thead>
                          <tbody>{stuAssign.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).map(a => {
                            const pct = a.obtainedMarks!=null ? Math.round((a.obtainedMarks/a.totalMarks)*100) : null;
                            return (
                              <tr key={a.id}>
                                <td style={{fontWeight:500}}>{a.title}</td>
                                <td style={{color:"var(--text-secondary)"}}>{a.subject||"—"}</td>
                                <td><span className={`badge ${a.status==="graded"?"badge-green":a.status==="submitted"?"badge-amber":"badge-rose"}`}>{a.status}</span></td>
                                <td>{a.obtainedMarks!=null?`${a.obtainedMarks}/${a.totalMarks}`:"—"}</td>
                                <td>
                                  {pct!=null && (
                                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                                      <div style={{width:50,height:6,background:"var(--bg-card)",borderRadius:3,overflow:"hidden"}}>
                                        <div style={{width:`${pct}%`,height:"100%",background:pct>=80?"var(--accent-teal)":pct>=60?"var(--accent-amber)":"var(--accent-rose)",borderRadius:3}}/>
                                      </div>
                                      <span style={{fontSize:11,color:pct>=80?"var(--accent-teal)":pct>=60?"var(--accent-amber)":"var(--accent-rose)",fontWeight:600}}>{pct}%</span>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}</tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
              </>
            }
          </>
        )}

        {/* NOTIFICATIONS */}
        {page === "notifications" && (
          <>
            <div className="page-header" style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div><h1>Notifications</h1><p>Updates from your students</p></div>
              {unread > 0 && <button className="btn btn-outline" onClick={markAllRead}>Mark all read</button>}
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
        {/* STUDY MATERIALS */}
        {page === "materials" && (
          <>
            <div className="page-header" style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div><h1>Study Materials</h1><p>Upload and manage files for your students</p></div>
              <button className="btn btn-blue" onClick={() => setShowMaterialModal(true)}>+ Upload Material</button>
            </div>

            {/* Filter by student */}
            <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
              {[{id:"all",name:"All Students"}, ...students].map(s => (
                <button key={s.id} className="btn btn-sm"
                  style={{
                    background: (materialForm.studentId===s.id||(!materialForm.studentId&&s.id==="all")) ? "var(--accent-blue)" : "var(--bg-secondary)",
                    color: (materialForm.studentId===s.id||(!materialForm.studentId&&s.id==="all")) ? "white" : "var(--text-secondary)",
                    border:"1px solid var(--border)"
                  }}
                  onClick={() => setMaterialForm(f=>({...f,studentId:s.id}))}>
                  {s.name}
                </button>
              ))}
            </div>

            {(() => {
              const filtered = materials.filter(m =>
                materialForm.studentId === "all" ? true :
                m.studentId === materialForm.studentId || m.studentId === "all"
              );
              if (filtered.length === 0) return (
                <div className="card"><div className="empty-state"><div className="empty-icon">📚</div><p>No materials yet. Upload your first file above.</p></div></div>
              );
              return (
                <div className="grid-2">
                  {filtered.map(m => {
                    const isImage = m.fileType?.startsWith("image/");
                    const isPdf = m.fileType === "application/pdf";
                    const icon = isImage ? "🖼️" : isPdf ? "📄" : m.fileType?.startsWith("video/") ? "🎬" : "📎";
                    const targetStudent = m.studentId === "all" ? "All Students" : students.find(s=>s.id===m.studentId)?.name || "Unknown";
                    return (
                      <div key={m.id} className="card" style={{marginBottom:0}}>
                        <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                          <div style={{fontSize:32,flexShrink:0}}>{icon}</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontWeight:600,fontSize:15,marginBottom:4}}>{m.title}</div>
                            {m.description && <div style={{fontSize:13,color:"var(--text-secondary)",marginBottom:8}}>{m.description}</div>}
                            <div style={{fontSize:12,color:"var(--text-muted)",marginBottom:10}}>
                              {m.fileName} · For: {targetStudent}
                            </div>
                            <div style={{display:"flex",gap:8}}>
                              <a href={m.fileUrl} download={m.fileName}
                                style={{display:"inline-flex",alignItems:"center",gap:6,padding:"6px 12px",background:"rgba(61,142,240,0.1)",borderRadius:6,fontSize:12,color:"var(--accent-blue)",textDecoration:"none"}}>
                                ⬇️ Download
                              </a>
                              <button className="btn btn-sm btn-danger" onClick={() => deleteMaterial(m)}>🗑️ Delete</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </>
        )}

        {/* MESSAGES */}
        {page === "messages" && (
          <>
            <div className="page-header"><h1>Messages</h1><p>Chat privately with each student</p></div>
            <div className="card" style={{ padding: 0, height: "70vh", display: "flex", overflow: "hidden" }}>
              <div style={{ width: 240, borderRight: "1px solid var(--border)", overflowY: "auto", padding: "12px 8px" }}>
                {students.length === 0
                  ? <div className="empty-state"><div className="empty-icon">👥</div><p style={{fontSize:13}}>No students yet</p></div>
                  : students.map(s => {
                    const unread = unreadByStudent[s.id] || 0;
                    return (
                      <div key={s.id} className={`chat-list-item ${activeChatStudent?.id===s.id?"active":""}`} onClick={() => setActiveChatStudent(s)}>
                        <div className="user-avatar" style={{width:36,height:36,fontSize:14,background:"#1D3A66"}}>{s.name?.charAt(0)?.toUpperCase()}</div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:600,fontSize:13,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.name}</div>
                        </div>
                        {unread > 0 && (
                          <span style={{background:"var(--accent-rose)",color:"white",borderRadius:10,padding:"1px 7px",fontSize:11,fontWeight:700,flexShrink:0}}>{unread}</span>
                        )}
                      </div>
                    );
                  })
                }
              </div>
              <div style={{ flex: 1 }}>
                <ChatWindow myUid={currentUser.uid} otherUid={activeChatStudent?.id} otherName={activeChatStudent?.name} myName={userProfile.name} otherEmail={activeChatStudent?.email} />
              </div>
            </div>
          </>
        )}

        {/* PACKAGES */}
        {page === "packages" && (
          <>
            <div className="page-header" style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div><h1>Class Packages</h1><p>Track prepaid class blocks — no payment math, just classes remaining</p></div>
              <button className="btn btn-blue" onClick={() => setShowPackageModal(true)}>+ Create Package</button>
            </div>

            {packages.length === 0
              ? <div className="card"><div className="empty-state"><div className="empty-icon">🎟️</div><p>No packages yet. Create one for a prepaid class block.</p></div></div>
              : packages.map(pkg => {
                const { used, remaining, sessions: usedSessions } = getPackageUsage(pkg);
                const pct = Math.min(100, Math.round((used / pkg.totalClasses) * 100));
                const linkedStudents = students.filter(s => pkg.studentIds.includes(s.id));
                const allSessions = sessions.filter(s => s.packageId === pkg.id).sort((a,b) => (a.utcTimestamp||0) - (b.utcTimestamp||0));
                const isLow = remaining <= 3 && remaining > 0;
                const isDone = remaining <= 0;

                return (
                  <div key={pkg.id} className="card" style={{marginBottom:20}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                      <div>
                        <div style={{fontWeight:700,fontSize:18,marginBottom:4}}>{pkg.name}</div>
                        <div style={{fontSize:13,color:"var(--text-secondary)"}}>
                          {linkedStudents.map(s => s.name).join(" & ")}
                          {pkg.paidDate && ` · Paid on ${pkg.paidDate}`}
                        </div>
                        {pkg.note && pkg.note.split("\n").map((line, i) => (
                          <div key={i} style={{fontSize:12,color:"var(--text-muted)",marginTop:4}}>💬 {line}</div>
                        ))}
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        {isDone
                          ? <span className="badge badge-rose">Package Complete</span>
                          : isLow
                          ? <span className="badge badge-amber">⚠️ {remaining} left</span>
                          : <span className="badge badge-green">{remaining} left</span>
                        }
                        <button className="btn btn-sm btn-outline" onClick={() => { setTopUpPackage(pkg); setTopUpAmount("8"); }}>
                          + Add Classes
                        </button>
                      </div>
                    </div>

                    <div style={{marginBottom:8,display:"flex",justifyContent:"space-between",fontSize:13}}>
                      <span style={{color:"var(--text-secondary)"}}>{used} of {pkg.totalClasses} classes used</span>
                      <span style={{fontWeight:600,color:"var(--accent-teal)"}}>{pct}%</span>
                    </div>
                    <div className="progress-bar" style={{height:10,marginBottom:20}}>
                      <div className="progress-fill" style={{width:`${pct}%`,background: isDone ? "var(--accent-rose)" : isLow ? "var(--accent-amber)" : "var(--accent-teal)"}}></div>
                    </div>

                    {allSessions.length > 0 && (
                      <div style={{borderTop:"1px solid var(--border)",paddingTop:16}}>
                        <div style={{fontSize:12,fontWeight:600,color:"var(--text-muted)",marginBottom:10,textTransform:"uppercase",letterSpacing:"0.5px"}}>Session Log</div>
                        <div style={{display:"flex",flexDirection:"column",gap:8}}>
                          {allSessions.map(s => (
                            <div key={s.id} style={{display:"flex",alignItems:"center",gap:10,fontSize:13}}>
                              <span style={{fontSize:16}}>{s.status==="completed" ? "☑️" : "☐"}</span>
                              <span style={{color:"var(--text-secondary)",minWidth:90}}>{s.date}</span>
                              <span className="badge badge-blue" style={{flexShrink:0}}>{s.studentName}</span>
                              <span style={{flex:1,color:"var(--text-primary)"}}>{s.topic}</span>
                              {s.status !== "completed" && <button className="btn btn-sm btn-outline" onClick={() => markSessionDone(s)}>Mark Done</button>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {allSessions.length === 0 && (
                      <p style={{fontSize:13,color:"var(--text-muted)",textAlign:"center",padding:"10px 0"}}>
                        No sessions logged yet. New bookings for {linkedStudents.map(s=>s.name).join(" & ")} will automatically appear here.
                      </p>
                    )}
                  </div>
                );
              })
            }
          </>
        )}

        {/* PAYMENTS */}
        {page === "payments" && (
          <>
            <div className="page-header" style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div><h1>Payments</h1><p>Track invoices and payment status per student</p></div>
              <button className="btn btn-blue" onClick={() => setShowInvoiceModal(true)}>+ Create Invoice</button>
            </div>
            {invoices.length === 0
              ? <div className="card"><div className="empty-state"><div className="empty-icon">💳</div><p>No invoices created yet.</p></div></div>
              : <div className="card">
                <table className="data-table"><thead><tr><th>Student</th><th>Month</th><th>Amount</th><th>Notes</th><th>Status</th><th>Proof</th></tr></thead>
                  <tbody>{invoices.map(inv => (
                    <tr key={inv.id}>
                      <td style={{fontWeight:500}}>{inv.studentName}</td>
                      <td>{inv.month}</td>
                      <td style={{fontWeight:600,color:"var(--accent-teal)"}}>{inv.currency || "$"}{inv.amount}</td>
                      <td style={{color:"var(--text-secondary)",fontSize:12,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{inv.notes || "—"}</td>
                      <td><span className={`badge ${inv.status==="paid"?"badge-green":"badge-rose"}`}>{inv.status}</span></td>
                      <td>
                        {inv.proofUrl
                          ? <a href={inv.proofUrl} download={inv.proofName} style={{color:"var(--accent-blue)",fontSize:12}}>📄 {inv.proofName}</a>
                          : <span style={{color:"var(--text-muted)"}}>—</span>
                        }
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            }
          </>
        )}
        </div>
      </div>

      {/* MODAL: Add Availability */}
      {showAvailModal && (
        <div className="modal-overlay" onClick={() => setShowAvailModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Add Timeslot</h3>
            <p style={{fontSize:13,color:"var(--text-secondary)",marginBottom:20}}>All times are in <strong style={{color:"var(--accent-teal)"}}>Pakistan Time (PKT)</strong></p>
            <div className="field"><label>Day of Week</label>
              <select value={availDay} onChange={e => setAvailDay(e.target.value)}>
                {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div className="field"><label>Start Time (PKT)</label>
                <select value={availStart} onChange={e => setAvailStart(e.target.value)}>
                  {TIME_OPTIONS.map(t => <option key={t} value={t}>{fmt12(t)}</option>)}
                </select>
              </div>
              <div className="field"><label>End Time (PKT)</label>
                <select value={availEnd} onChange={e => setAvailEnd(e.target.value)}>
                  {TIME_OPTIONS.map(t => <option key={t} value={t}>{fmt12(t)}</option>)}
                </select>
              </div>
            </div>
            <div className="field"><label>Session Duration</label>
              <select value={availDuration} onChange={e => setAvailDuration(e.target.value)}>
                <option value="50">50 minutes</option>
              </select>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowAvailModal(false)}>Cancel</button>
              <button className="btn btn-blue" onClick={addAvailability}>Add Timeslot</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Grade Assignment */}
      {gradeModal && (
        <div className="modal-overlay" onClick={() => setGradeModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Grade Assignment</h3>
            <p style={{fontSize:14,color:"var(--text-secondary)",marginBottom:8}}>
              <strong style={{color:"var(--text-primary)"}}>{gradeModal.title}</strong> · {gradeModal.studentName}
            </p>
            <p style={{fontSize:13,color:"var(--text-secondary)",marginBottom:20}}>Total marks: {gradeModal.totalMarks}</p>

            {gradeModal.submittedNote && (
              <div style={{background:"var(--bg-secondary)",padding:"10px 14px",borderRadius:8,marginBottom:16,fontSize:13}}>
                <div style={{fontSize:11,fontWeight:600,color:"var(--text-muted)",marginBottom:4,textTransform:"uppercase"}}>Student Note</div>
                {gradeModal.submittedNote}
              </div>
            )}
            {gradeModal.pdfName && (
              <a href={gradeModal.pdfUrl} download={gradeModal.pdfName}
                style={{display:"inline-flex",alignItems:"center",gap:6,padding:"6px 12px",background:"rgba(56,201,176,0.1)",borderRadius:6,fontSize:13,color:"var(--accent-teal)",textDecoration:"none",marginBottom:16}}>
                📄 Download submission: {gradeModal.pdfName}
              </a>
            )}

            <div className="field">
              <label>Marks Obtained *</label>
              <input type="number" min="0" max={gradeModal.totalMarks}
                placeholder={`Out of ${gradeModal.totalMarks}`}
                value={gradeForm.marks}
                onChange={e => setGradeForm(f => ({...f, marks: e.target.value}))} />
            </div>
            <div className="field">
              <label>Feedback for Student</label>
              <textarea placeholder="Write your feedback, corrections, or encouragement..."
                value={gradeForm.feedback}
                onChange={e => setGradeForm(f => ({...f, feedback: e.target.value}))} />
            </div>

            <div className="field">
              <label>Attach Feedback PDF (optional)</label>
              <div style={{
                border:"2px dashed var(--border)", borderRadius:8, padding:"16px",
                textAlign:"center", cursor:"pointer",
                background: gradePdf ? "rgba(56,201,176,0.05)" : "var(--bg-secondary)",
                borderColor: gradePdf ? "var(--accent-teal)" : "var(--border)",
                transition:"all 0.2s"
              }}
                onClick={() => document.getElementById("grade-pdf").click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if(f?.type==="application/pdf") setGradePdf(f); else toast.error("Only PDF files allowed."); }}
              >
                <input id="grade-pdf" type="file" accept=".pdf" style={{display:"none"}}
                  onChange={e => { if(e.target.files[0]) setGradePdf(e.target.files[0]); }} />
                {gradePdf ? (
                  <div>
                    <div style={{fontSize:24,marginBottom:4}}>📄</div>
                    <div style={{fontWeight:600,color:"var(--accent-teal)",fontSize:13}}>{gradePdf.name}</div>
                    <div style={{fontSize:11,color:"var(--text-secondary)",marginTop:2}}>{(gradePdf.size/1024).toFixed(0)} KB</div>
                    <button className="btn btn-sm btn-danger" style={{marginTop:8}}
                      onClick={e => { e.stopPropagation(); setGradePdf(null); }}>Remove</button>
                  </div>
                ) : (
                  <div>
                    <div style={{fontSize:24,marginBottom:4}}>📎</div>
                    <div style={{fontSize:13,color:"var(--text-secondary)"}}>Attach corrected work or feedback PDF</div>
                    <div style={{fontSize:11,color:"var(--text-muted)",marginTop:2}}>PDF only · Max 5MB</div>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => { setGradeModal(null); setGradePdf(null); }}>Cancel</button>
              <button className="btn btn-teal" onClick={gradeAssignment}>Save Grade & Notify Student</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Upload Material */}
      {showMaterialModal && (
        <div className="modal-overlay" onClick={() => { setShowMaterialModal(false); setMaterialFile(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Upload Study Material</h3>
            <div className="field"><label>For Student</label>
              <select value={materialForm.studentId} onChange={e => setMaterialForm(f=>({...f,studentId:e.target.value}))}>
                <option value="all">All Students</option>
                {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="field"><label>Title *</label>
              <input placeholder="e.g. Chapter 3 Notes, Practice Problems" value={materialForm.title} onChange={e => setMaterialForm(f=>({...f,title:e.target.value}))} />
            </div>
            <div className="field"><label>Description (optional)</label>
              <textarea placeholder="Brief description of this material..." value={materialForm.description} onChange={e => setMaterialForm(f=>({...f,description:e.target.value}))} />
            </div>
            <div className="field"><label>File *</label>
              <div style={{
                border:"2px dashed var(--border)", borderRadius:8, padding:"20px",
                textAlign:"center", cursor:"pointer",
                background: materialFile ? "rgba(56,201,176,0.05)" : "var(--bg-secondary)",
                borderColor: materialFile ? "var(--accent-teal)" : "var(--border)"
              }}
                onClick={() => document.getElementById("material-file").click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); if(e.dataTransfer.files[0]) setMaterialFile(e.dataTransfer.files[0]); }}
              >
                <input id="material-file" type="file" style={{display:"none"}} onChange={e => { if(e.target.files[0]) setMaterialFile(e.target.files[0]); }} />
                {materialFile ? (
                  <div>
                    <div style={{fontSize:28,marginBottom:6}}>
                      {materialFile.type?.startsWith("image/") ? "🖼️" : materialFile.type==="application/pdf" ? "📄" : materialFile.type?.startsWith("video/") ? "🎬" : "📎"}
                    </div>
                    <div style={{fontWeight:600,color:"var(--accent-teal)",fontSize:13}}>{materialFile.name}</div>
                    <div style={{fontSize:11,color:"var(--text-secondary)",marginTop:2}}>{(materialFile.size/1024).toFixed(0)} KB</div>
                    <button className="btn btn-sm btn-danger" style={{marginTop:8}} onClick={e=>{e.stopPropagation();setMaterialFile(null);}}>Remove</button>
                  </div>
                ) : (
                  <div>
                    <div style={{fontSize:28,marginBottom:6}}>📁</div>
                    <div style={{fontSize:13,color:"var(--text-secondary)"}}>Click or drag & drop any file</div>
                    <div style={{fontSize:11,color:"var(--text-muted)",marginTop:2}}>PDF, image, video, Word, etc.</div>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => { setShowMaterialModal(false); setMaterialFile(null); }}>Cancel</button>
              <button className="btn btn-blue" onClick={uploadMaterial} disabled={materialUploading}>
                {materialUploading ? "Uploading..." : "Upload"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Cancel Confirmation */}
      {cancelSession && (
        <div className="modal-overlay" onClick={() => setCancelSession(null)}>
          <div className="modal" style={{maxWidth:420}} onClick={e => e.stopPropagation()}>
            <h3>Cancel Session?</h3>
            <p style={{fontSize:14,color:"var(--text-secondary)",margin:"12px 0 20px"}}>
              Are you sure you want to cancel <strong style={{color:"var(--text-primary)"}}>{cancelSession.topic}</strong> with <strong style={{color:"var(--text-primary)"}}>{cancelSession.studentName}</strong>?
              <br/><span style={{fontSize:12,color:"var(--text-muted)",marginTop:4,display:"block"}}>{cancelSession.utcTimestamp ? formatInPKT(cancelSession.utcTimestamp) : cancelSession.date}</span>
            </p>
            <p style={{fontSize:13,color:"var(--accent-amber)"}}>⚠️ The student will be notified by email.</p>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setCancelSession(null)}>Keep Session</button>
              <button className="btn btn-danger" onClick={() => cancelSessionFn(cancelSession)}>Yes, Cancel It</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Schedule Session / Reschedule */}
      {showScheduleModal && (
        <div className="modal-overlay" onClick={() => { setShowScheduleModal(false); setRescheduleSession(null); }}>
          <div className="modal" style={{maxWidth:680, maxHeight:"85vh", overflowY:"auto"}} onClick={e => e.stopPropagation()}>
            <h3>{rescheduleSession ? "🔄 Reschedule Session" : "Schedule a Session"}</h3>
            {rescheduleSession && (
              <div style={{background:"rgba(61,142,240,0.08)",border:"1px solid rgba(61,142,240,0.2)",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:13}}>
                Rescheduling: <strong>{rescheduleSession.topic}</strong> for <strong>{rescheduleSession.studentName}</strong>
                <br/><span style={{color:"var(--text-secondary)"}}>Original: {rescheduleSession.utcTimestamp ? formatInPKT(rescheduleSession.utcTimestamp) : rescheduleSession.date}</span>
              </div>
            )}
            <p style={{fontSize:13,color:"var(--text-secondary)",marginBottom:20}}>
              Pick a new time from your <strong style={{color:"var(--accent-teal)"}}>availability grid</strong> below.
            </p>

            {!rescheduleSession && (
              <div className="field"><label>Students * {scheduleForm.studentIds.length > 1 && <span style={{color:"var(--accent-teal)",fontWeight:400,fontSize:12}}>— shared session (counts as 1 class)</span>}</label>
                <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:4}}>
                  {students.map(s => {
                    const checked = scheduleForm.studentIds.includes(s.id);
                    return (
                      <div key={s.id} onClick={() => setScheduleForm(f => ({
                          ...f,
                          studentIds: checked ? f.studentIds.filter(id => id !== s.id) : [...f.studentIds, s.id]
                        }))}
                        style={{
                          display:"flex",alignItems:"center",gap:10,padding:"10px 14px",
                          borderRadius:8,cursor:"pointer",border:"1px solid",
                          borderColor: checked ? "var(--accent-blue)" : "var(--border)",
                          background: checked ? "rgba(61,142,240,0.1)" : "var(--bg-secondary)"
                        }}>
                        <div style={{width:18,height:18,borderRadius:4,border:"2px solid",borderColor:checked?"var(--accent-blue)":"var(--border)",background:checked?"var(--accent-blue)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                          {checked && <span style={{color:"white",fontSize:12,lineHeight:1}}>✓</span>}
                        </div>
                        <span style={{fontWeight:500,color:checked?"var(--accent-blue)":"var(--text-primary)"}}>{s.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {Object.keys(availabilityGrid).length === 0 ? (
              <div className="empty-state"><div className="empty-icon">🕐</div><p>You haven't painted any availability yet. Go to "My Availability" first.</p></div>
            ) : (
              <>
                <div style={{marginBottom:6,fontSize:13,fontWeight:600,color:"var(--text-secondary)"}}>Step 1 — Click an available time slot (PKT)</div>
                <div style={{overflowX:"auto",marginBottom:20}}>
                  <AvailabilityGridViewer
                    availabilityMap={availabilityGrid}
                    convertToLocal={false}
                    selectedSlotKey={scheduleForm.slotKey}
                    onSlotClick={(slot) => setScheduleForm(f => ({...f, slotKey: slot.key, slotDay: slot.day, slotStartPKT: slot.startPKT, slotEndPKT: slot.endPKT, slotDuration: slot.duration, date: ""}))}
                    maxHeight={300}
                  />
                </div>

                {scheduleForm.slotDay && (
                  <div className="field">
                    <div style={{marginBottom:6,fontSize:13,fontWeight:600,color:"var(--text-secondary)"}}>
                      Step 2 — Pick which {scheduleForm.slotDay} ({fmt12(scheduleForm.slotStartPKT)}–{fmt12(scheduleForm.slotEndPKT)})
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                      {getNextDays(60).filter(d => {
                        if (d.dayName !== scheduleForm.slotDay) return false;
                        if (hasScheduleConflict(d.date, scheduleForm.slotStartPKT, scheduleForm.slotEndPKT)) return false;
                        return true;
                      }).slice(0,6).map(d => (
                        <button key={d.date} type="button"
                          onClick={() => setScheduleForm(f => ({...f, date: d.date}))}
                          style={{
                            padding:"8px 14px", borderRadius:8, border:"1px solid",
                            borderColor: scheduleForm.date===d.date ? "var(--accent-blue)" : "var(--border)",
                            background: scheduleForm.date===d.date ? "rgba(61,142,240,0.15)" : "var(--bg-secondary)",
                            color: scheduleForm.date===d.date ? "var(--accent-blue)" : "var(--text-primary)",
                            cursor:"pointer", fontSize:13, fontWeight:500
                          }}>
                          {d.display}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="field"><label>Topic *</label>
                  <input placeholder="e.g. Variables and Loops" value={scheduleForm.topic} onChange={e => setScheduleForm(f => ({...f, topic: e.target.value}))} />
                </div>
              </>
            )}

            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => { setShowScheduleModal(false); setRescheduleSession(null); }}>Cancel</button>
              {scheduleForm.slotDay && scheduleForm.date && (
                <button className="btn btn-blue" onClick={rescheduleSession ? doReschedule : scheduleSession}>
                  {rescheduleSession ? "Confirm Reschedule" : "Confirm Session"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Add Classes to Package */}
      {topUpPackage && (
        <div className="modal-overlay" onClick={() => { setTopUpPackage(null); setTopUpNote(""); }}>
          <div className="modal" style={{maxWidth:400}} onClick={e => e.stopPropagation()}>
            <h3>Add Classes</h3>
            <p style={{fontSize:14,color:"var(--text-secondary)",marginBottom:20}}>
              Adding to: <strong style={{color:"var(--text-primary)"}}>{topUpPackage.name}</strong>
              <br/><span style={{fontSize:12,color:"var(--text-muted)"}}>Current total: {topUpPackage.totalClasses} classes</span>
            </p>
            <div className="field">
              <label>How many classes to add?</label>
              <input type="number" min="1" value={topUpAmount}
                onChange={e => setTopUpAmount(e.target.value)}
                placeholder="e.g. 8"
              />
            </div>
            <div className="field">
              <label>Note (optional)</label>
              <input
                placeholder="e.g. $80 paid for 8 classes via Remitly"
                value={topUpNote}
                onChange={e => setTopUpNote(e.target.value)}
              />
              <div style={{fontSize:11,color:"var(--text-muted)",marginTop:4}}>
                This will appear below the existing note on the package.
              </div>
            </div>
            {topUpAmount && parseInt(topUpAmount) > 0 && (
              <div style={{padding:"10px 14px",background:"rgba(56,201,176,0.08)",borderRadius:8,fontSize:13,color:"var(--accent-teal)",marginBottom:4}}>
                New total will be: <strong>{topUpPackage.totalClasses + parseInt(topUpAmount)} classes</strong>
              </div>
            )}
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => { setTopUpPackage(null); setTopUpNote(""); }}>Cancel</button>
              <button className="btn btn-blue" onClick={addClassesToPackage}>Add Classes</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Create Package */}
      {showPackageModal && (
        <div className="modal-overlay" onClick={() => setShowPackageModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Create Class Package</h3>
            <p style={{fontSize:13,color:"var(--text-secondary)",marginBottom:20}}>
              For a prepaid block of classes — no payment tracking, just a class countdown.
            </p>

            <div className="field"><label>Package Name *</label>
              <input placeholder="e.g. Smith Siblings — 24 Classes" value={packageForm.name} onChange={e => setPackageForm(f => ({...f, name: e.target.value}))} />
            </div>

            <div className="field"><label>Students * (select one or more — shared package if multiple)</label>
              <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:4}}>
                {students.map(s => {
                  const isChecked = packageForm.studentIds.includes(s.id);
                  return (
                    <label key={s.id} style={{
                      display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderRadius:8,
                      border:"1px solid", borderColor: isChecked ? "var(--accent-blue)" : "var(--border)",
                      background: isChecked ? "rgba(61,142,240,0.08)" : "var(--bg-secondary)",
                      cursor:"pointer"
                    }}>
                      <input type="checkbox" checked={isChecked}
                        onChange={() => {
                          setPackageForm(f => ({
                            ...f,
                            studentIds: isChecked ? f.studentIds.filter(id => id !== s.id) : [...f.studentIds, s.id]
                          }));
                        }}
                        style={{width:16,height:16}}
                      />
                      <span style={{fontSize:14}}>{s.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div className="field"><label>Total Classes *</label>
                <input type="number" min="1" value={packageForm.totalClasses} onChange={e => setPackageForm(f => ({...f, totalClasses: e.target.value}))} />
              </div>
              <div className="field"><label>Paid Date</label>
                <input type="date" value={packageForm.paidDate} onChange={e => setPackageForm(f => ({...f, paidDate: e.target.value}))} />
              </div>
            </div>

            <div className="field"><label>Note (optional)</label>
              <textarea placeholder="e.g. Paid in full by brother, $240 for 24 classes" value={packageForm.note} onChange={e => setPackageForm(f => ({...f, note: e.target.value}))} />
            </div>

            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowPackageModal(false)}>Cancel</button>
              <button className="btn btn-blue" onClick={createPackage}>Create Package</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Create Invoice */}
      {showInvoiceModal && (
        <div className="modal-overlay" onClick={() => setShowInvoiceModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Create Invoice</h3>
            <div className="field"><label>Student *</label>
              <select value={invoiceForm.studentId} onChange={e => setInvoiceForm(f => ({...f, studentId: e.target.value}))}>
                <option value="">Select student</option>
                {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="field"><label>Month *</label>
              <input type="month" value={invoiceForm.month} onChange={e => setInvoiceForm(f => ({...f, month: e.target.value}))} />
            </div>
            <div style={{display:"grid",gridTemplateColumns:"80px 1fr",gap:12}}>
              <div className="field"><label>Currency</label>
                <select value={invoiceForm.currency} onChange={e => setInvoiceForm(f => ({...f, currency: e.target.value}))}>
                  <option value="$">$</option>
                  <option value="Rs">Rs</option>
                  <option value="€">€</option>
                  <option value="£">£</option>
                </select>
              </div>
              <div className="field"><label>Amount *</label>
                <input type="number" placeholder="e.g. 200" value={invoiceForm.amount} onChange={e => setInvoiceForm(f => ({...f, amount: e.target.value}))} />
              </div>
            </div>
            <div className="field"><label>Notes</label>
              <textarea placeholder="e.g. 8 classes this month, 2 makeup sessions included" value={invoiceForm.notes} onChange={e => setInvoiceForm(f => ({...f, notes: e.target.value}))} />
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowInvoiceModal(false)}>Cancel</button>
              <button className="btn btn-blue" onClick={createInvoice}>Send Invoice</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Add Student */}
      {showAddStudent && (
        <div className="modal-overlay" onClick={() => setShowAddStudent(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Add Student</h3>
            <div className="field"><label>Student's Email Address</label>
              <input placeholder="student@email.com" value={studentEmail} onChange={e => setStudentEmail(e.target.value)} onKeyDown={e => e.key==="Enter" && addStudent()} />
            </div>
            <p style={{fontSize:12,color:"var(--text-secondary)",marginTop:-8}}>The student must have already created an account.</p>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowAddStudent(false)}>Cancel</button>
              <button className="btn btn-blue" onClick={addStudent}>Add Student</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Add Assignment */}
      {showAddAssignment && (
        <div className="modal-overlay" onClick={() => setShowAddAssignment(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>New Assignment</h3>
            <div className="field"><label>Student *</label>
              <select value={assignForm.studentId} onChange={e => setAssignForm(f=>({...f,studentId:e.target.value}))}>
                <option value="">Select student</option>
                {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="field"><label>Title *</label><input placeholder="e.g. Java OOP Homework #3" value={assignForm.title} onChange={e => setAssignForm(f=>({...f,title:e.target.value}))} /></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div className="field"><label>Subject</label><input placeholder="e.g. Java" value={assignForm.subject} onChange={e => setAssignForm(f=>({...f,subject:e.target.value}))} /></div>
              <div className="field"><label>Total Marks</label><input type="number" value={assignForm.totalMarks} onChange={e => setAssignForm(f=>({...f,totalMarks:e.target.value}))} /></div>
            </div>
            <div className="field"><label>Due Date *</label><input type="date" value={assignForm.dueDate} onChange={e => setAssignForm(f=>({...f,dueDate:e.target.value}))} /></div>
            <div className="field"><label>Description</label><textarea placeholder="Describe the assignment..." value={assignForm.description} onChange={e => setAssignForm(f=>({...f,description:e.target.value}))} /></div>

            {/* PDF Upload */}
            <div className="field">
              <label>Attach PDF (optional)</label>
              <div style={{
                border:"2px dashed var(--border)", borderRadius:8, padding:"16px",
                textAlign:"center", cursor:"pointer",
                background: assignPdf ? "rgba(56,201,176,0.05)" : "var(--bg-secondary)",
                borderColor: assignPdf ? "var(--accent-teal)" : "var(--border)",
                transition:"all 0.2s"
              }}
                onClick={() => document.getElementById("assign-pdf").click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if(f?.type==="application/pdf") setAssignPdf(f); else toast.error("Only PDF files allowed."); }}
              >
                <input id="assign-pdf" type="file" accept=".pdf" style={{display:"none"}}
                  onChange={e => { if(e.target.files[0]) setAssignPdf(e.target.files[0]); }} />
                {assignPdf ? (
                  <div>
                    <div style={{fontSize:24,marginBottom:4}}>📄</div>
                    <div style={{fontWeight:600,color:"var(--accent-teal)",fontSize:13}}>{assignPdf.name}</div>
                    <div style={{fontSize:11,color:"var(--text-secondary)",marginTop:2}}>{(assignPdf.size/1024).toFixed(0)} KB</div>
                    <button className="btn btn-sm btn-danger" style={{marginTop:8}}
                      onClick={e => { e.stopPropagation(); setAssignPdf(null); }}>Remove</button>
                  </div>
                ) : (
                  <div>
                    <div style={{fontSize:24,marginBottom:4}}>📎</div>
                    <div style={{fontSize:13,color:"var(--text-secondary)"}}>Click or drag & drop PDF here</div>
                    <div style={{fontSize:11,color:"var(--text-muted)",marginTop:2}}>PDF only · Max 5MB</div>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => { setShowAddAssignment(false); setAssignPdf(null); }}>Cancel</button>
              <button className="btn btn-blue" onClick={addAssignment}>Send Assignment</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
