function localCalendarParts(instant: string, timeZone?: string): { year: string; month: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    calendar: "gregory",
    year: "numeric",
    month: "2-digit",
    ...(timeZone ? { timeZone } : {})
  }).formatToParts(new Date(instant));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) throw new Error("Could not project timeline date into the local calendar.");
  return { year, month };
}

export function timelineMonthKey(instant: string, timeZone?: string): string {
  const { year, month } = localCalendarParts(instant, timeZone);
  return `${year}-${month}`;
}

export function timelineYearKey(instant: string, timeZone?: string): string {
  return localCalendarParts(instant, timeZone).year;
}

export function timelineMonthLabel(instant: string, timeZone?: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    calendar: "gregory",
    month: "long",
    year: "numeric",
    ...(timeZone ? { timeZone } : {})
  }).format(new Date(instant));
}
