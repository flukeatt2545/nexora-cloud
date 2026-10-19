"use client";

// The idle time before signing out, typed in seconds, minutes, hours or days. The API stores
// whole minutes (5 minutes to 30 days), so seconds are rounded to the minute and the field says so.
import { useState } from "react";
import "./session-ttl.css";

type Unit = "sec" | "min" | "hour" | "day";

const units: { id: Unit; label: string; seconds: number }[] = [
  { id: "sec", label: "วินาที", seconds: 1 },
  { id: "min", label: "นาที", seconds: 60 },
  { id: "hour", label: "ชั่วโมง", seconds: 3600 },
  { id: "day", label: "วัน", seconds: 86400 },
];

const presets = [
  { label: "15 นาที", minutes: 15 },
  { label: "1 ชั่วโมง", minutes: 60 },
  { label: "8 ชั่วโมง", minutes: 480 },
  { label: "1 วัน", minutes: 1440 },
  { label: "7 วัน", minutes: 10080 },
  { label: "30 วัน", minutes: 43200 },
];

const MIN_MINUTES = 5;
const MAX_MINUTES = 43200;

function bestUnit(minutes: number): Unit {
  if (minutes >= 1440 && minutes % 1440 === 0) return "day";
  if (minutes >= 60 && minutes % 60 === 0) return "hour";
  return "min";
}

function factor(unit: Unit) {
  return units.find((item) => item.id === unit)!.seconds;
}

function amountFor(minutes: number, unit: Unit) {
  const value = (minutes * 60) / factor(unit);
  return String(Number(value.toFixed(2)));
}

/** "1 วัน 6 ชั่วโมง" style wording for a number of minutes. */
export function describeMinutes(minutes: number) {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts = [days && `${days} วัน`, hours && `${hours} ชั่วโมง`, mins && `${mins} นาที`].filter(Boolean);
  return parts.length ? parts.join(" ") : "0 นาที";
}

export default function SessionTtlField({ value, onChange }: { value: number; onChange: (minutes: number) => void }) {
  const [unit, setUnit] = useState<Unit>(() => bestUnit(value));
  const [amount, setAmount] = useState(() => amountFor(value, bestUnit(value)));
  const [seen, setSeen] = useState(value);
  const [emitted, setEmitted] = useState(value);

  // A value from outside (settings loaded, a preset) resets the field; our own edits do not, so
  // typing 90 seconds is not replaced by "2 minutes" mid-typing.
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
  const typedSeconds = Number.isFinite(number) ? number * factor(unit) : NaN;
  const minutes = Math.round(typedSeconds / 60);
  const rounded = Number.isFinite(typedSeconds) && typedSeconds > 0 && typedSeconds % 60 !== 0;
  const tooShort = Number.isFinite(minutes) && minutes < MIN_MINUTES;
  const tooLong = Number.isFinite(minutes) && minutes > MAX_MINUTES;

  function emit(nextAmount: string, nextUnit: Unit) {
    setAmount(nextAmount);
    setUnit(nextUnit);
    const parsed = Number(nextAmount);
    if (!nextAmount.trim() || !Number.isFinite(parsed)) return;
    const nextMinutes = Math.round((parsed * factor(nextUnit)) / 60);
    setEmitted(nextMinutes);
    onChange(nextMinutes);
  }

  function changeUnit(next: Unit) {
    // Keep the same length of time, shown in the new unit.
    const keep = Number.isFinite(minutes) && minutes > 0 ? minutes : value;
    emit(amountFor(keep, next), next);
  }

  return (
    <div className="ttl-field">
      <div className={`ttl-row${tooShort || tooLong ? " is-invalid" : ""}`}>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={amount}
          onChange={(event) => emit(event.target.value, unit)}
          aria-label="ระยะเวลา"
          aria-invalid={tooShort || tooLong}
        />
        <div className="ttl-units" role="radiogroup" aria-label="หน่วยเวลา">
          {units.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={unit === item.id}
              className={unit === item.id ? "is-active" : ""}
              onClick={() => changeUnit(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <p className={`ttl-note${tooShort || tooLong ? " is-invalid" : ""}`} aria-live="polite">
        {tooShort
          ? `สั้นที่สุด ${MIN_MINUTES} นาที (300 วินาที)`
          : tooLong
            ? "ยาวที่สุด 30 วัน"
            : Number.isFinite(minutes) && minutes > 0
              ? <>เท่ากับ <strong>{describeMinutes(minutes)}</strong>{rounded ? " (ระบบนับเป็นนาที จึงปัดเศษวินาที)" : ""}</>
              : "ใส่ตัวเลข"}
      </p>
      <div className="ttl-presets" aria-label="ตัวเลือกด่วน">
        {presets.map((preset) => (
          <button
            key={preset.minutes}
            type="button"
            className={value === preset.minutes ? "is-active" : ""}
            onClick={() => {
              const next = bestUnit(preset.minutes);
              emit(amountFor(preset.minutes, next), next);
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
