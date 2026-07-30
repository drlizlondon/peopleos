import type { PhoneRegionOption } from "./integrations/contactValues";

type PhoneRegionSelectProps = {
  id: string;
  value: string;
  options: readonly PhoneRegionOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
};

export default function PhoneRegionSelect({
  id,
  value,
  options,
  onChange,
  ariaLabel
}: PhoneRegionSelectProps) {
  const selected = options.find((option) => option.code === value) ?? options[0];

  return (
    <span className="phone-region-select" title={selected?.label}>
      <span className="phone-region-code" aria-hidden="true">{selected?.callingCode ?? "+"}</span>
      <span className="phone-region-chevron" aria-hidden="true">⌄</span>
      <select
        id={id}
        value={selected?.code ?? value}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.code} value={option.code}>{option.label}</option>
        ))}
      </select>
    </span>
  );
}
