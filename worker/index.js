// Cloudflare Worker: serves the React app (static assets) and runs the lesson reminders.
// - Cron Trigger (every minute) calls checkReminders() on schedule.
// - GET /api/send-reminders runs the same check manually (handy for testing).
// Replaces the old Vercel function + cron-job.org.

async function checkReminders() {
  try {
    const FIREBASE_DB_URL = "https://mytutortracker-default-rtdb.firebaseio.com";
    const EMAILJS_SERVICE_ID = "service_d4hi557";
    const EMAILJS_TEMPLATE_ID = "template_rlalk5z";
    const EMAILJS_PUBLIC_KEY = "0TaVPhHuiqCYxmnRv";

    // 1. Fetch all tutors' sessions
    const tutorsRes = await fetch(`${FIREBASE_DB_URL}/tutors.json`);
    const tutorsData = await tutorsRes.json();
    if (!tutorsData) return { message: "No tutors found." };

    const now = Date.now();
    const fifteenMinFromNow = now + 15 * 60 * 1000;
    const windowBuffer = 60 * 1000; // 1 minute buffer for cron timing drift

    let remindersSent = 0;

    for (const tutorId of Object.keys(tutorsData)) {
      const sessions = tutorsData[tutorId]?.sessions || {};
      for (const sessionId of Object.keys(sessions)) {
        const session = sessions[sessionId];
        if (!session.utcTimestamp || session.status !== "scheduled") continue;
        if (session.reminderSent) continue;

        const startsAt = session.utcTimestamp;
        // Check if session starts in approximately 15 minutes (within the buffer window)
        if (startsAt >= fifteenMinFromNow - windowBuffer && startsAt <= fifteenMinFromNow + windowBuffer) {
          // Fetch student email
          const studentRes = await fetch(`${FIREBASE_DB_URL}/users/${session.studentId}.json`);
          const studentData = await studentRes.json();
          const studentEmail = studentData?.email;
          const studentName = studentData?.name || session.studentName;

          if (studentEmail) {
            await fetch("https://api.emailjs.com/api/v1.0/email/send", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                service_id: EMAILJS_SERVICE_ID,
                template_id: EMAILJS_TEMPLATE_ID,
                user_id: EMAILJS_PUBLIC_KEY,
                template_params: {
                  to_email: studentEmail,
                  to_name: studentName,
                  subject: `Your class "${session.topic}" starts in 15 minutes! ⏰`,
                  message: `Hi ${studentName},\n\nJust a reminder — your session "${session.topic}" with ${session.tutorName} starts in 15 minutes.\n\nSee you soon!`
                }
              })
            });
            remindersSent++;
          }

          // Also notify tutor
          const tutorRes = await fetch(`${FIREBASE_DB_URL}/users/${tutorId}.json`);
          const tutorData = await tutorRes.json();
          if (tutorData?.email) {
            await fetch("https://api.emailjs.com/api/v1.0/email/send", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                service_id: EMAILJS_SERVICE_ID,
                template_id: EMAILJS_TEMPLATE_ID,
                user_id: EMAILJS_PUBLIC_KEY,
                template_params: {
                  to_email: tutorData.email,
                  to_name: tutorData.name,
                  subject: `Your class "${session.topic}" starts in 15 minutes! ⏰`,
                  message: `Hi ${tutorData.name},\n\nReminder — your session "${session.topic}" with ${session.studentName} starts in 15 minutes.`
                }
              })
            });
          }

          // Mark reminder as sent so we don't send it twice
          await fetch(`${FIREBASE_DB_URL}/tutors/${tutorId}/sessions/${sessionId}/reminderSent.json`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(true)
          });
          await fetch(`${FIREBASE_DB_URL}/students/${session.studentId}/sessions/${sessionId}/reminderSent.json`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(true)
          });
        }
      }
    }

    return { message: "Checked sessions.", remindersSent };
  } catch (err) {
    console.error("Reminder check failed:", err);
    return { error: err.message };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/send-reminders") {
      const result = await checkReminders();
      return Response.json(result, { status: result.error ? 500 : 200 });
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkReminders());
  },
};
