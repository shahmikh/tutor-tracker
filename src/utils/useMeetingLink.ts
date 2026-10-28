import { useEffect, useState } from "react";
import { ref, onValue, set } from "firebase/database";
import { db } from "../firebase/config";

// The tutor's lesson meeting link (Zoom / Google Meet / etc), stored at meetingLink/<tutorUid>.
export default function useMeetingLink(tutorUid?: string): [string, (value: string) => Promise<void>] {
  const [link, setLink] = useState("");
  useEffect(() => {
    if (!tutorUid) { setLink(""); return; }
    return onValue(ref(db, `meetingLink/${tutorUid}`), snap => setLink(snap.val() || ""), () => setLink(""));
  }, [tutorUid]);
  const save = (value: string) => set(ref(db, `meetingLink/${tutorUid}`), value.trim());
  return [link, save];
}

// A lesson is joinable from 10 minutes before it starts until it ends.
export function joinWindow(session?: { utcTimestamp?: number; duration?: number | string } | null, now: number = Date.now()): boolean {
  if (!session?.utcTimestamp) return false;
  const end = session.utcTimestamp + (Number(session.duration) || 50) * 60000;
  return now >= session.utcTimestamp - 10 * 60000 && now <= end;
}
