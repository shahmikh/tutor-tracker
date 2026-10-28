// Cloudflare Worker: serves the React app (static assets) and runs the lesson reminders.
// - Cron Trigger (every minute) calls checkReminders() on schedule.
// - GET /api/send-reminders runs the same check manually (handy for testing).
// Replaces the old Vercel function + cron-job.org.


// --- Firebase access for the reminder job -------------------------------
// Once the database security rules are on, anonymous reads are denied. The Worker
// then signs in as a Firebase service account (secret FIREBASE_SERVICE_ACCOUNT, the
// JSON key) and passes an OAuth token. Without the secret it falls back to
// unauthenticated calls, which only work while the rules are still open.
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
let cachedToken = null;

async function getFirebaseToken(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) return null;
  if (cachedToken && cachedToken.exp > Date.now() + 60000) return cachedToken.value;
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64u(sig)}` }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Firebase token error: " + JSON.stringify(data));
  cachedToken = { value: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

async function checkReminders(env) {
  try {
    const FIREBASE_DB_URL = "https://mytutortracker-default-rtdb.firebaseio.com";
    const EMAILJS_SERVICE_ID = "service_d4hi557";
    const EMAILJS_TEMPLATE_ID = "template_rlalk5z";
    const EMAILJS_PUBLIC_KEY = "0TaVPhHuiqCYxmnRv";
    const token = await getFirebaseToken(env);
    const q = token ? `?access_token=${token}` : "";

    // 1. Fetch all tutors' sessions
    const tutorsRes = await fetch(`${FIREBASE_DB_URL}/tutors.json${q}`);
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
          const studentRes = await fetch(`${FIREBASE_DB_URL}/users/${session.studentId}.json${q}`);
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
          const tutorRes = await fetch(`${FIREBASE_DB_URL}/users/${tutorId}.json${q}`);
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
          await fetch(`${FIREBASE_DB_URL}/tutors/${tutorId}/sessions/${sessionId}/reminderSent.json${q}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(true)
          });
          await fetch(`${FIREBASE_DB_URL}/students/${session.studentId}/sessions/${sessionId}/reminderSent.json${q}`, {
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
      const result = await checkReminders(env);
      return Response.json(result, { status: result.error ? 500 : 200 });
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkReminders(env));
  },
};
