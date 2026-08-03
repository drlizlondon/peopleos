import { useId, useRef, useState, type FormEvent } from "react";
import { useModalSheet } from "./TodaySheets";
import { addDaysToLocalDate } from "./domain/followUpPolicy";
import type { LocalDate } from "./domain/schema";

type PauseUnit = "days" | "weeks" | "months";

type Props = {
  personName: string;
  todayDate: LocalDate;
  saving: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (resumeOn: LocalDate) => void;
};

const unitDays: Record<PauseUnit, number> = {
  days: 1,
  weeks: 7,
  months: 30
};

function formatUkDate(value: LocalDate): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(year, month - 1, day));
}

export default function RegularReminderPauseSheet({
  personName,
  todayDate,
  saving,
  error,
  onClose,
  onConfirm
}: Props) {
  const [amount, setAmount] = useState("1");
  const [unit, setUnit] = useState<PauseUnit>("weeks");
  const resultId = useId();
  const amountRef = useRef<HTMLInputElement>(null);
  const sheetRef = useModalSheet("regular-reminder-pause", onClose, amountRef, saving);
  const numericAmount = Number(amount);
  const totalDays = Number.isInteger(numericAmount) && numericAmount > 0
    ? numericAmount * unitDays[unit]
    : 0;
  const resumeOn = totalDays > 0 && totalDays <= 3_650
    ? addDaysToLocalDate(todayDate, totalDays)
    : undefined;
  const maximumAmount = Math.floor(3_650 / unitDays[unit]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (resumeOn && !saving) onConfirm(resumeOn);
  }

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section
        ref={sheetRef}
        className="contact-sheet regular-reminder-pause-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="regular-reminder-pause-title"
      >
        <div className="sheet-heading">
          <div>
            <p className="eyebrow">Keep in touch</p>
            <h3 id="regular-reminder-pause-title">Pause reminders</h3>
          </div>
          <button type="button" aria-label="Close pause reminders" disabled={saving} onClick={onClose}>×</button>
        </div>
        <form onSubmit={submit}>
          <div className="regular-reminder-pause-fields">
            <label>
              <span>For</span>
              <input
                ref={amountRef}
                type="number"
                inputMode="numeric"
                min="1"
                max={maximumAmount}
                step="1"
                value={amount}
                disabled={saving}
                aria-describedby={resultId}
                aria-invalid={!resumeOn || undefined}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <label>
              <span>Unit</span>
              <select
                value={unit}
                disabled={saving}
                aria-describedby={resultId}
                aria-invalid={!resumeOn || undefined}
                onChange={(event) => setUnit(event.target.value as PauseUnit)}
              >
                <option value="days">Days</option>
                <option value="weeks">Weeks</option>
                <option value="months">Months</option>
              </select>
            </label>
          </div>
          {resumeOn
            ? <p id={resultId} className="regular-reminder-resume-date" role="status" aria-live="polite" aria-atomic="true">Resume on: <strong>{formatUkDate(resumeOn)}</strong></p>
            : <p id={resultId} className="form-alert" role="alert">Choose a pause between 1 day and 10 years.</p>}
          <p className="muted-copy">Only regular reminders for {personName} are paused.</p>
          {error && <p className="form-alert" role="alert">{error}</p>}
          <div className="button-row sheet-actions">
            <button type="button" disabled={saving} onClick={onClose}>Cancel</button>
            <button className="primary-action" type="submit" disabled={saving || !resumeOn}>
              {saving ? "Pausing…" : "Pause reminders"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
