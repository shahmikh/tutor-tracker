import React, { useState, useRef, useCallback, useEffect } from "react";
import { DAYS } from "../utils/timezone";

// 30-min slots from 00:00 to 23:30 = 48 rows
const TOTAL_ROWS = 48;
function rowToTime(row) {
  const h = Math.floor(row / 2);
  const m = (row % 2) * 30;
  return `${h.toString().padStart(2,"0")}:${m.toString().padStart(2,"0")}`;
}
function timeToRow(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 2 + (m >= 30 ? 1 : 0);
}
function fmt12(time) {
  const [h, m] = time.split(":").map(Number);
  const ampm = h === 0 || h < 12 ? "AM" : "PM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2,"0")} ${ampm}`;
}

const SHORT_DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const ROW_HEIGHT = 18;

/**
 * TUTOR EDITOR — click & drag to paint availability cells.
 * value: { Monday: [rowIndex, rowIndex, ...], Tuesday: [...], ... }
 * onChange(newValue)
 */
export function AvailabilityGridEditor({ value, onChange, maxHeight = 480 }) {
  const [dragging, setDragging] = useState(false);
  const [dragMode, setDragMode] = useState("add"); // "add" or "remove"
  const gridRef = useRef(null);
  const scrollRef = useRef(null);

  const isPainted = (day, row) => (value[day] || []).includes(row);

  const paintCell = useCallback((day, row, mode) => {
    onChange(prev => {
      const current = new Set(prev[day] || []);
      if (mode === "add") current.add(row);
      else current.delete(row);
      return { ...prev, [day]: Array.from(current).sort((a,b)=>a-b) };
    });
  }, [onChange]);

  const handleMouseDown = (day, row) => {
    const mode = isPainted(day, row) ? "remove" : "add";
    setDragMode(mode);
    setDragging(true);
    paintCell(day, row, mode);
  };
  const handleMouseEnter = (day, row) => {
    if (dragging) paintCell(day, row, dragMode);
  };
  const handleMouseUp = () => setDragging(false);

  // Auto-scroll to 6 AM on first mount so users don't have to scroll past empty night hours
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 6 * 2 * ROW_HEIGHT; // row 12 = 6:00 AM
    }
  }, []);

  // Visible hour labels every 2 rows (1 hour)
  const hourRows = [];
  for (let r = 0; r < TOTAL_ROWS; r += 2) hourRows.push(r);

  return (
    <div
      ref={gridRef}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ userSelect: "none", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}
    >
      <div ref={scrollRef} style={{ overflowX: "auto", overflowY: "auto", maxHeight }}>
      <div style={{ display: "flex" }}>
      {/* Time labels column */}
      <div style={{ width: 56, flexShrink: 0, background: "var(--bg-card)" }}>
        <div style={{ height: 32, borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "var(--bg-card)", zIndex: 3 }}></div>
        {hourRows.map(r => (
          <div key={r} style={{ height: ROW_HEIGHT * 2, fontSize: 10, color: "var(--text-muted)", textAlign: "right", paddingRight: 6, borderBottom: "1px solid var(--border)", display:"flex", alignItems:"flex-start", justifyContent:"flex-end", paddingTop:2, boxSizing:"border-box" }}>
            {fmt12(rowToTime(r))}
          </div>
        ))}
      </div>

      {/* Day columns */}
      {DAYS.map((day, di) => (
        <div key={day} style={{ flex: 1, minWidth: 60, borderLeft: di > 0 ? "1px solid var(--border)" : "none" }}>
          <div style={{ height: 32, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", borderBottom: "1px solid var(--border)", background: "var(--bg-card)", position: "sticky", top: 0, zIndex: 3 }}>
            {SHORT_DAYS[di]}
          </div>
          {Array.from({ length: TOTAL_ROWS }).map((_, row) => {
            const painted = isPainted(day, row);
            const isHourLine = row % 2 === 0;
            return (
              <div
                key={row}
                onMouseDown={() => handleMouseDown(day, row)}
                onMouseEnter={() => handleMouseEnter(day, row)}
                style={{
                  height: ROW_HEIGHT,
                  background: painted ? "var(--accent-blue)" : "var(--bg-secondary)",
                  borderBottom: isHourLine ? "1px solid var(--border)" : "1px solid rgba(11,31,58,0.06)",
                  cursor: "pointer",
                  transition: "background 0.05s"
                }}
              />
            );
          })}
        </div>
      ))}
      </div>
      </div>
    </div>
  );
}

/**
 * Converts painted rows into contiguous time ranges per day.
 * e.g. [36,37,38,39] (18:00-20:00) -> { day: "Monday", startRow: 36, endRow: 40, startTime: "18:00", endTime: "20:00" }
 */
export function getRangesFromPaintedRows(availabilityMap) {
  const ranges = [];
  DAYS.forEach(day => {
    const rows = (availabilityMap[day] || []).slice().sort((a,b) => a-b);
    let start = null, prev = null;
    rows.forEach(row => {
      if (start === null) { start = row; prev = row; return; }
      if (row === prev + 1) { prev = row; return; }
      ranges.push({ day, startRow: start, endRow: prev + 1, startTime: rowToTime(start), endTime: rowToTime(prev + 1) });
      start = row; prev = row;
    });
    if (start !== null) ranges.push({ day, startRow: start, endRow: prev + 1, startTime: rowToTime(start), endTime: rowToTime(prev + 1) });
  });
  return ranges;
}

/**
 * Generates bookable 50-min slots from a continuous range, one for EVERY clean half-hour mark
 * (9:00, 9:30, 10:00...) as long as the full 50 minutes fits before the range ends.
 * This means adjacent slots overlap by 10 minutes in raw terms, but in practice a student can only
 * book ONE of them for a given half-hour window — once booked, the next class naturally starts at
 * the next half-hour mark after the session + 10-min buffer (e.g. 9:30-10:20 session -> next slot 10:30).
 */
export function generateBookableSlots(range, durationMin = 50) {
  const slots = [];
  const startMinutesTotal = range.startRow * 30;
  const endMinutesTotal = range.endRow * 30;
  let cursor = startMinutesTotal;
  while (cursor + durationMin <= endMinutesTotal) {
    const h1 = Math.floor(cursor / 60), m1 = cursor % 60;
    const endCursor = cursor + durationMin;
    const h2 = Math.floor(endCursor / 60), m2 = endCursor % 60;
    slots.push({
      day: range.day,
      startPKT: `${h1.toString().padStart(2,"0")}:${m1.toString().padStart(2,"0")}`,
      endPKT: `${h2.toString().padStart(2,"0")}:${m2.toString().padStart(2,"0")}`,
      duration: durationMin
    });
    cursor += 30; // advance by a clean half-hour each time, not by the session duration
  }
  return slots;
}

/**
 * Computes the offset in 30-minute ROWS between PKT (UTC+5) and the viewer's local timezone.
 * Rounds to the nearest 30-min row to keep grid math in clean integers (avoids half-pixel bugs).
 */
function getPktToLocalOffsetRows() {
  const now = new Date();
  const localOffsetFromUTC = -now.getTimezoneOffset(); // minutes
  const pktOffsetFromUTC = 300; // PKT = UTC+5
  const diffMinutes = localOffsetFromUTC - pktOffsetFromUTC;
  return Math.round(diffMinutes / 30); // whole rows only
}

// Shifts a {day, row} position by a given number of whole 30-min row-steps, wrapping across day boundaries
function shiftDayRow(day, row, offsetRows) {
  let newRow = row + offsetRows;
  let dayIndex = DAYS.indexOf(day);
  while (newRow < 0) { newRow += TOTAL_ROWS; dayIndex = (dayIndex - 1 + 7) % 7; }
  while (newRow >= TOTAL_ROWS) { newRow -= TOTAL_ROWS; dayIndex = (dayIndex + 1) % 7; }
  return { day: DAYS[dayIndex], row: newRow };
}

/**
 * STUDENT/READ-ONLY VIEW — shows painted availability as a grid; bookable slots are clickable.
 * Automatically converts from PKT (how it's stored) to the viewer's local browser timezone for display.
 * The underlying startPKT/endPKT/day values returned in onSlotClick remain in PKT (source of truth for booking).
 * onSlotClick(slot)
 */
export function AvailabilityGridViewer({ availabilityMap, onSlotClick, selectedSlotKey, dayLabels, convertToLocal = true, maxHeight = 480 }) {
  const offsetRows = convertToLocal ? getPktToLocalOffsetRows() : 0;

  // Build per-day bookable slot list from ranges (in PKT terms — this is the source of truth)
  const ranges = getRangesFromPaintedRows(availabilityMap);
  const slotsByDay = {};
  ranges.forEach(range => {
    const slots = generateBookableSlots(range, 50);
    if (!slotsByDay[range.day]) slotsByDay[range.day] = [];
    slotsByDay[range.day].push(...slots);
  });

  const hourRows = [];
  for (let r = 0; r < TOTAL_ROWS; r += 2) hourRows.push(r);

  // Build a flat list of slots, each carrying both its PKT identity (for booking) and its
  // shifted display position (for rendering in the viewer's local timezone)
  const displaySlotsByDay = {};
  DAYS.forEach(day => {
    (slotsByDay[day] || []).forEach(slot => {
      const startRowPKT = timeToRow(slot.startPKT);
      const { day: displayDay, row: displayStartRow } = shiftDayRow(day, startRowPKT, offsetRows);
      const key = `${day}|${slot.startPKT}`; // identity stays PKT-based, stable regardless of viewer
      if (!displaySlotsByDay[displayDay]) displaySlotsByDay[displayDay] = [];
      displaySlotsByDay[displayDay].push({
        ...slot,
        day, // original PKT day (for booking)
        displayStartRow,
        key
      });
    });
  });

  // Find the overall min/max row across all displayed slots, so we only render the relevant hours
  let minRow = TOTAL_ROWS, maxRow = 0;
  Object.values(displaySlotsByDay).forEach(slots => {
    slots.forEach(s => {
      minRow = Math.min(minRow, s.displayStartRow);
      maxRow = Math.max(maxRow, s.displayStartRow + s.duration / 30);
    });
  });
  if (minRow > maxRow) { minRow = 12; maxRow = 36; } // fallback: show 6am-6pm if nothing painted
  // Pad by 1 hour on each side, clamp to grid bounds
  const viewStartRow = Math.max(0, minRow - 2);
  const viewEndRow = Math.min(TOTAL_ROWS, maxRow + 2);
  const visibleHourRows = hourRows.filter(r => r >= viewStartRow && r < viewEndRow);
  const gridPixelHeight = (viewEndRow - viewStartRow) * ROW_HEIGHT;

  return (
    <div style={{ userSelect: "none", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ overflowX: "auto", overflowY: "auto", maxHeight }}>
      <div style={{ display: "flex" }}>
      <div style={{ width: 56, flexShrink: 0, background: "var(--bg-card)" }}>
        <div style={{ height: 40, borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "var(--bg-card)", zIndex: 3 }}></div>
        <div style={{ position: "relative", height: gridPixelHeight }}>
          {visibleHourRows.map(r => (
            <div key={r} style={{ position: "absolute", top: (r - viewStartRow) * ROW_HEIGHT, height: ROW_HEIGHT * 2, fontSize: 10, color: "var(--text-muted)", textAlign: "right", paddingRight: 6, borderBottom: "1px solid var(--border)", width: "100%", display:"flex", alignItems:"flex-start", justifyContent:"flex-end", paddingTop:2, boxSizing:"border-box" }}>
              {fmt12(rowToTime(r))}
            </div>
          ))}
        </div>
      </div>

      {DAYS.map((day, di) => {
        const daySlots = (displaySlotsByDay[day] || []).sort((a,b) => a.displayStartRow - b.displayStartRow);
        return (
          <div key={day} style={{ flex: 1, minWidth: 90, borderLeft: di > 0 ? "1px solid var(--border)" : "none", position: "relative" }}>
            <div style={{ height: 40, display: "flex", flexDirection:"column", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", borderBottom: "1px solid var(--border)", background: "var(--bg-card)", position: "sticky", top: 0, zIndex: 3 }}>
              <span>{SHORT_DAYS[di]}</span>
              {dayLabels?.[day] && <span style={{fontSize:10,color:"var(--text-muted)",fontWeight:400}}>{dayLabels[day]}</span>}
            </div>
            <div style={{ position: "relative", height: gridPixelHeight }}>
              {/* faint background grid */}
              {Array.from({ length: viewEndRow - viewStartRow }).map((_, idx) => {
                const row = viewStartRow + idx;
                return (
                  <div key={row} style={{
                    position: "absolute", top: idx * ROW_HEIGHT, left: 0, right: 0, height: ROW_HEIGHT,
                    borderBottom: row % 2 === 0 ? "1px solid var(--border)" : "1px solid rgba(11,31,58,0.06)"
                  }}/>
                );
              })}
              {/* bookable slot blocks (positioned at their LOCAL display time, even if that spills onto this visual day from a PKT-adjacent day) */}
              {daySlots.map((slot, i) => {
                const span = slot.duration / 30;
                if (slot.displayStartRow + span <= viewStartRow || slot.displayStartRow >= viewEndRow) return null;
                const visibleStartRow = Math.max(viewStartRow, slot.displayStartRow) - viewStartRow;
                const visibleEndRow = Math.min(viewEndRow, slot.displayStartRow + span) - viewStartRow;
                const visibleSpan = visibleEndRow - visibleStartRow;
                if (visibleSpan <= 0) return null;
                const isSelected = selectedSlotKey === slot.key;
                // Compute local display time label
                const localStartTotalMin = slot.displayStartRow * 30;
                const localEndTotalMin = localStartTotalMin + slot.duration;
                const localStartLabel = fmt12(`${Math.floor(localStartTotalMin/60).toString().padStart(2,"0")}:${(localStartTotalMin%60).toString().padStart(2,"0")}`);
                const localEndLabel = fmt12(`${Math.floor((localEndTotalMin%1440)/60).toString().padStart(2,"0")}:${(localEndTotalMin%60).toString().padStart(2,"0")}`);
                return (
                  <div
                    key={i}
                    onClick={() => {
                      const pktDayIndex = DAYS.indexOf(slot.day);
                      const displayDayIndex = DAYS.indexOf(day);
                      let dayOffset = displayDayIndex - pktDayIndex;
                      if (dayOffset > 3) dayOffset -= 7;
                      if (dayOffset < -3) dayOffset += 7;
                      onSlotClick && onSlotClick({
                        day, // the day as the VIEWER sees it (use this to match calendar dates)
                        pktDay: slot.day, // the original PKT day (source of truth for the actual booking time)
                        dayOffset, // how many calendar days to shift PKT date by to land on the viewer's display date
                        startPKT: slot.startPKT, endPKT: slot.endPKT, duration: slot.duration, key: slot.key,
                        localLabel: `${localStartLabel} – ${localEndLabel}`
                      });
                    }}
                    style={{
                      position: "absolute",
                      top: visibleStartRow * ROW_HEIGHT + 2,
                      left: 3, right: 3,
                      height: Math.max(visibleSpan * ROW_HEIGHT - 4, 14),
                      background: isSelected ? "var(--accent-teal)" : "rgba(29,58,102,0.88)",
                      border: isSelected ? "2px solid var(--accent-teal)" : "1px solid rgba(29,58,102,1)",
                      borderRadius: 5,
                      cursor: "pointer",
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                      fontSize: 9.5, fontWeight: 600, color: "white",
                      transition: "all 0.15s",
                      padding: "1px 2px", textAlign: "center", lineHeight: 1.15,
                      zIndex: isSelected ? 2 : 1,
                      overflow: "hidden", whiteSpace: "nowrap"
                    }}
                    title={`${localStartLabel} - ${localEndLabel}`}
                  >
                    <span>{localStartLabel}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      </div>
      </div>
    </div>
  );
}

export { rowToTime, timeToRow, fmt12, generateBookableSlots as generateSlots };
