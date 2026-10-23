"use client";

// The idle time before signing out, typed in seconds, minutes, hours or days. The API keeps whole
// seconds, from 10 seconds to 30 days.
import { ChevronDown, CircleAlert } from "lucide-react";
import { useId, useState } from "react";
import "./session-ttl.css";

type Unit = "sec" | "min" | "hour" | "day";

const units: { id: Unit; label: string; seconds: number }[] = [
  { id: "sec", label: "วินาที", seconds: 1 },
  { id: "min", label: "นาที", seconds: 60 },
  { id: "hour", label: "ชั่วโมง", seconds: 3600 },
  { id: "day", label: "วัน", seconds: 86400 },
];

const presets = [
  { label: "30 วินาที", seconds: 30 },
  { label: "5 นาที", seconds: 300 },
  { label: "15 นาที", seconds: 900 },
  { label: "1 ชั่วโมง", seconds: 3600 },
  { label: "8 ชั่วโมง", seconds: 28800 },
  { label: "1 วัน", seconds: 86400 },
  { label: "7 วัน", seconds: 604800 },
  { label: "30 วัน", seconds: 2592000 },
];

const MIN_IDLE_SECONDS = 10;
const MAX_IDLE_SECONDS = 2592000;
/** Below this the field warns that people will be signed out almost as soon as they stop. */
const SHORT_SECONDS = 60;

function bestUnit(seconds: number): Unit {
  if (seconds >= 86400 && seconds % 86400 === 0) return "day";
  if (seconds >= 3600 && seconds % 3600 === 0) return "hour";
  if (seconds >= 60 && seconds % 60 === 0) return "min";
  return seconds < 60 ? "sec" : "min";
}

function factor(unit: Unit) {
  return units.find((item) => item.id === unit)!.seconds;
}

function amountFor(seconds: number, unit: Unit) {
  return String(Number((seconds / factor(unit)).toFixed(2)));
}

/** "1 วัน 6 ชั่วโมง" style wording for a number of seconds. */
export function describeSeconds(total: number) {
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const parts = [days && `${days} วัน`, hours && `${hours} ชั่วโมง`, minutes && `${minutes} นาที`, seconds && `${seconds} วินาที`].filter(Boolean);
  return parts.length ? parts.join(" ") : "0 วินาที";
}

export default function SessionTtlField({ value, onChange }: { value: number; onChange: (seconds: number) => void }) {
  const [unit, setUnit] = useState<Unit>(() => bestUnit(value));
  const [amount, setAmount] = useState(() => amountFor(value, bestUnit(value)));
  const [seen, setSeen] = useState(value);
  const [emitted, setEmitted] = useState(value);
  const noteId = useId();

  // A value from outside (settings loaded, a preset) resets the field; our own edits do not, so
  // typing 90 seconds is not replaced by "1.5 minutes" mid-typing.
  if (value !== seen) {
    setSeen(value);
    if (value !== emitted) {
      const next = bestUnit(value);
      setUnit(next);
      setAmount(amountFor(value, next));
      setEmitted(value);
    }
  }

  const number = Number(amount);
  const seconds = Number.isFinite(number) ? Math.round(number * factor(unit)) : NaN;
  const tooShort = Number.isFinite(seconds) && seconds < MIN_IDLE_SECONDS;
  const tooLong = Number.isFinite(seconds) && seconds > MAX_IDLE_SECONDS;
  const invalid = tooShort || tooLong;
  const short = !invalid && Number.isFinite(seconds) && seconds < SHORT_SECONDS;

  function emit(nextAmount: string, nextUnit: Unit) {
    setAmount(nextAmount);
    setUnit(nextUnit);
    const parsed = Number(nextAmount);
    if (!nextAmount.trim() || !Number.isFinite(parsed)) return;
    const next = Math.round(parsed * factor(nextUnit));
    setEmitted(next);
    onChange(next);
  }

  function pick(next: number) {
    const nextUnit = bestUnit(next);
    emit(amountFor(next, nextUnit), nextUnit);
  }

  function changeUnit(next: Unit) {
    // Keep the same length of time, shown in the new unit.
    const keep = Number.isFinite(seconds) && seconds > 0 ? seconds : value;
    emit(amountFor(keep, next), next);
  }

  return (
    <div className="ttl-field">
      <div className={`ttl-row${invalid ? " is-invalid" : ""}`}>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={amount}
          onChange={(event) => emit(event.target.value, unit)}
          aria-label="ระยะเวลา"
          aria-invalid={invalid}
          aria-describedby={noteId}
        />
        <label className="ttl-unit">
          <span className="ttl-sr">หน่วยเวลา</span>
          <select value={unit} onChange={(event) => changeUnit(event.target.value as Unit)}>
            {units.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <ChevronDown size={16} aria-hidden="true" />
        </label>
      </div>
      <p id={noteId} className={`ttl-note${invalid ? " is-invalid" : short ? " is-short" : ""}`} aria-live="polite">
        {invalid ? (
          <>
            <CircleAlert size={15} aria-hidden="true" />
            <span>{tooShort ? `สั้นที่สุด ${MIN_IDLE_SECONDS} วินาที` : "ยาวที่สุด 30 วัน"}</span>
            <button type="button" className="ttl-fix" onClick={() => pick(tooShort ? MIN_IDLE_SECONDS : MAX_IDLE_SECONDS)}>
              ใช้ {tooShort ? `${MIN_IDLE_SECONDS} วินาที` : "30 วัน"}
            </button>
          </>
        ) : Number.isFinite(seconds) && seconds > 0 ? (
          <>
            เท่ากับ <strong>{describeSeconds(seconds)}</strong>
            {short && <span className="ttl-short">สั้นมาก ใครหยุดใช้งานแป๊บเดียวจะถูกออกจากระบบ</span>}
          </>
        ) : "ใส่ตัวเลข"}
      </p>
      <div className="ttl-presets" aria-label="ตัวเลือกด่วน">
        {presets.map((preset) => (
          <button key={preset.seconds} type="button" className={value === preset.seconds ? "is-active" : ""} onClick={() => pick(preset.seconds)}>
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
