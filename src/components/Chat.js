import React, { useState, useEffect, useRef } from "react";
import { db } from "../firebase/config";
import { ref, onValue, push, set } from "firebase/database";
import { sendEmail } from "../utils/email";
import toast from "react-hot-toast";

// Generates a consistent chat thread ID between any tutor and student
function getChatId(uid1, uid2) {
  return [uid1, uid2].sort().join("_");
}

function notify(uid, message, type = "message") {
  if (!uid) return;
  push(ref(db, `users/${uid}/notifications`), { message, type, read: false, createdAt: Date.now() });
}

// Hook to get unread message count for a specific chat (for chat list badges)
export function useUnreadCount(myUid, otherUid) {
  const [unreadCount, setUnreadCount] = useState(0);
  const chatId = otherUid ? getChatId(myUid, otherUid) : null;

  useEffect(() => {
    if (!chatId) { setUnreadCount(0); return; }
    const messagesRef = ref(db, `chats/${chatId}/messages`);
    const lastReadRef = ref(db, `chats/${chatId}/lastRead/${myUid}`);

    let lastRead = 0;
    let messages = {};

    const recompute = () => {
      const count = Object.values(messages).filter(m => m.senderId !== myUid && m.timestamp > lastRead).length;
      setUnreadCount(count);
    };

    const unsub1 = onValue(lastReadRef, snap => { lastRead = snap.val() || 0; recompute(); });
    const unsub2 = onValue(messagesRef, snap => { messages = snap.val() || {}; recompute(); });

    return () => { unsub1(); unsub2(); };
  }, [chatId, myUid]);

  return unreadCount;
}

// Hook to get TOTAL unread messages across ALL chats for a user (for sidebar badge)
export function useTotalUnreadMessages(myUid, otherUids) {
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({});

  useEffect(() => {
    if (!myUid || !otherUids || otherUids.length === 0) { setTotal(0); return; }
    const unsubs = [];
    const localCounts = {};

    otherUids.forEach(otherUid => {
      if (!otherUid) return;
      const chatId = getChatId(myUid, otherUid);
      const messagesRef = ref(db, `chats/${chatId}/messages`);
      const lastReadRef = ref(db, `chats/${chatId}/lastRead/${myUid}`);

      let lastRead = 0;
      let messages = {};

      const recompute = () => {
        const count = Object.values(messages).filter(m => m.senderId !== myUid && m.timestamp > lastRead).length;
        localCounts[otherUid] = count;
        setCounts({ ...localCounts });
        setTotal(Object.values(localCounts).reduce((a, b) => a + b, 0));
      };

      const u1 = onValue(lastReadRef, snap => { lastRead = snap.val() || 0; recompute(); });
      const u2 = onValue(messagesRef, snap => { messages = snap.val() || {}; recompute(); });
      unsubs.push(u1, u2);
    });

    return () => unsubs.forEach(u => u());
  }, [myUid, JSON.stringify(otherUids)]);

  return { total, counts };
}

// Marks a chat as read up to now
export async function markChatRead(myUid, otherUid) {
  if (!myUid || !otherUid) return;
  const chatId = getChatId(myUid, otherUid);
  await set(ref(db, `chats/${chatId}/lastRead/${myUid}`), Date.now());
}

export function useChat(myUid, otherUid) {
  const [messages, setMessages] = useState([]);
  const chatId = otherUid ? getChatId(myUid, otherUid) : null;

  useEffect(() => {
    if (!chatId) { setMessages([]); return; }
    const chatRef = ref(db, `chats/${chatId}/messages`);
    const unsub = onValue(chatRef, snap => {
      const data = snap.val() || {};
      setMessages(Object.entries(data).map(([id, v]) => ({ id, ...v })).sort((a,b) => a.timestamp - b.timestamp));
    });
    return () => unsub();
  }, [chatId]);

  // Send a text message, optionally with a file attachment
  const sendMessage = async (text, fileData, myName, otherEmail, otherName) => {
    if (!chatId) return;
    if (!text.trim() && !fileData) return;

    const msgData = {
      senderId: myUid,
      timestamp: Date.now(),
      ...(text.trim() && { text: text.trim() }),
      ...(fileData && { fileUrl: fileData.url, fileName: fileData.name, fileType: fileData.type })
    };

    const newRef = push(ref(db, `chats/${chatId}/messages`));
    await set(newRef, msgData);

    const previewText = text.trim() || (fileData ? `📎 ${fileData.name}` : "");
    await set(ref(db, `chats/${chatId}/lastMessage`), { text: previewText, senderId: myUid, timestamp: Date.now() });

    // Notify the other person
    notify(otherUid, `${myName}: ${previewText}`, "message");

    // Email the other person (only if they have one)
    if (otherEmail) {
      sendEmail(otherEmail, otherName, `New message from ${myName} 💬`,
        `Hi ${otherName},\n\n${myName} sent you a message on Shahmikh Classroom:\n\n"${previewText}"\n\nLog in to Shahmikh Classroom to reply.`
      );
    }
  };

  return { messages, sendMessage, chatId };
}

import { uploadFile } from "../utils/storage";

export function ChatWindow({ myUid, otherUid, otherName, myName, otherEmail }) {
  const { messages, sendMessage } = useChat(myUid, otherUid);
  const [input, setInput] = useState("");
  const [attachedFile, setAttachedFile] = useState(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    if (otherUid) markChatRead(myUid, otherUid);
  }, [messages, otherUid, myUid]);

  const handleFileSelect = (file) => {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { toast.error("File must be under 50MB."); return; }
    setAttachedFile(file);
  };

  const handleSend = async () => {
    if (!input.trim() && !attachedFile) return;
    setSending(true);

    let fileData = null;
    if (attachedFile) {
      const fileUrl = await uploadFile(attachedFile, `chat/${myUid}/${Date.now()}_${attachedFile.name}`);
      fileData = { url: fileUrl, name: attachedFile.name, type: attachedFile.type };
    }

    await sendMessage(input, fileData, myName, otherEmail, otherName);
    setInput("");
    setAttachedFile(null);
    setSending(false);
  };

  if (!otherUid) {
    return (
      <div className="empty-state" style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div className="empty-icon">💬</div>
        <p>Select a conversation to start chatting</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
        <div className="user-avatar" style={{ width: 36, height: 36, fontSize: 14, background: "#1D3A66" }}>
          {otherName?.charAt(0)?.toUpperCase()}
        </div>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{otherName}</div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.length === 0 ? (
          <div className="empty-state"><div className="empty-icon">👋</div><p>Say hello to start the conversation</p></div>
        ) : messages.map(m => {
          const isMine = m.senderId === myUid;
          const isImage = m.fileType?.startsWith("image/");
          return (
            <div key={m.id} className="chat-bubble-row" style={{ display: "flex", justifyContent: isMine ? "flex-end" : "flex-start" }}>
              <div className={`chat-bubble ${isMine ? "chat-bubble-mine" : "chat-bubble-theirs"}`}>
                {m.fileName && (
                  isImage ? (
                    <a href={m.fileUrl} download={m.fileName} target="_blank" rel="noreferrer">
                      <img src={m.fileUrl} alt={m.fileName} style={{maxWidth:200,borderRadius:8,display:"block",marginBottom:m.text?6:0}} />
                    </a>
                  ) : (
                    <a href={m.fileUrl} download={m.fileName}
                      style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",background:"rgba(255,255,255,0.1)",borderRadius:8,textDecoration:"none",color:"inherit",marginBottom:m.text?6:0}}>
                      📄 <span style={{fontSize:13,wordBreak:"break-all"}}>{m.fileName}</span>
                    </a>
                  )
                )}
                {m.text}
                <div className="chat-bubble-time">{new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef}></div>
      </div>

      {attachedFile && (
        <div style={{ padding: "10px 20px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, background: "var(--bg-secondary)" }}>
          <div style={{fontSize:18}}>📎</div>
          <div style={{flex:1,fontSize:13,color:"var(--text-secondary)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{attachedFile.name}</div>
          <button className="btn btn-sm btn-danger" onClick={() => setAttachedFile(null)}>✕</button>
        </div>
      )}

      <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: 10, alignItems: "center" }}>
        <input
          id="chat-file-input"
          type="file"
          style={{ display: "none" }}
          onChange={e => handleFileSelect(e.target.files[0])}
        />
        <button
          onClick={() => document.getElementById("chat-file-input").click()}
          style={{
            width: 38, height: 38, borderRadius: "50%", border: "1px solid var(--border)",
            background: "var(--bg-secondary)", color: "var(--text-secondary)", cursor: "pointer",
            fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
          }}
          title="Attach file"
        >
          📎
        </button>
        <input
          placeholder="Type a message..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !sending && handleSend()}
          style={{
            flex: 1, padding: "10px 14px", background: "var(--bg-secondary)",
            border: "1px solid var(--border)", borderRadius: 20, color: "var(--text-primary)",
            fontSize: 14, outline: "none"
          }}
        />
        <button className="btn btn-blue" style={{ borderRadius: 20, padding: "10px 20px" }} onClick={handleSend} disabled={sending}>
          {sending ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}

export { getChatId };
