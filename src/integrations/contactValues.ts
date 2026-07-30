import {
  getCountries,
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode
} from "libphonenumber-js/min";

export class ContactValueValidationError extends Error {
  constructor(
    public readonly kind: "phone" | "email",
    message: string
  ) {
    super(message);
    this.name = "ContactValueValidationError";
  }
}

export type NormalizedContactValue = {
  rawValue: string;
  canonicalValue: string;
  displayValue: string;
  region?: string;
};

export type PhoneRegionOption = {
  code: CountryCode;
  callingCode: string;
  label: string;
};

export function getPhoneRegionOptions(locale = "en-GB"): PhoneRegionOption[] {
  let displayNames: Intl.DisplayNames | undefined;
  try {
    displayNames = new Intl.DisplayNames([locale], { type: "region" });
  } catch {
    displayNames = undefined;
  }
  return getCountries()
    .map((code) => {
      const callingCode = `+${getCountryCallingCode(code)}`;
      return {
        code,
        callingCode,
        label: `${displayNames?.of(code) ?? code} ${callingCode}`
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label, locale) || left.code.localeCompare(right.code));
}

export function normalizeDefaultPhoneRegion(region: string): CountryCode {
  const candidate = region.trim().toUpperCase();
  if (!isSupportedCountry(candidate as CountryCode)) {
    throw new ContactValueValidationError("phone", "Choose a supported default phone region.");
  }
  return candidate as CountryCode;
}

export function normalizePhoneNumber(
  value: string,
  defaultRegion: string
): NormalizedContactValue {
  const rawValue = value.trim();
  if (!rawValue) {
    throw new ContactValueValidationError("phone", "Enter a phone number or remove this row.");
  }

  const region = normalizeDefaultPhoneRegion(defaultRegion);
  let phone = parsePhoneNumberFromString(rawValue, region);

  // People commonly paste an international number without its leading plus.
  // Retry only when the digits start with the selected region's calling code;
  // all actual parsing and validation still comes from libphonenumber.
  if (!phone?.isValid()) {
    const digits = rawValue.replace(/[^\d]/g, "");
    const callingCode = getCountryCallingCode(region);
    if (digits.startsWith(callingCode)) {
      phone = parsePhoneNumberFromString(`+${digits}`);
    }
  }

  if (!phone?.isValid()) {
    throw new ContactValueValidationError(
      "phone",
      "Enter a valid phone number, including the country code for international numbers."
    );
  }

  return {
    rawValue,
    canonicalValue: phone.number,
    displayValue: phone.country === region ? phone.formatNational() : phone.formatInternational(),
    ...(phone.country ? { region: phone.country } : {})
  };
}

export function normalizeEmailAddress(value: string): NormalizedContactValue {
  const rawValue = value.trim();
  const canonicalValue = rawValue.toLowerCase();
  if (!rawValue) {
    throw new ContactValueValidationError("email", "Enter an email address or remove this row.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawValue)) {
    throw new ContactValueValidationError("email", "Enter a valid email address, such as name@example.com.");
  }
  return { rawValue, canonicalValue, displayValue: rawValue };
}

export function normalizeContactValue(
  kind: "phone" | "email",
  value: string,
  defaultPhoneRegion: string
): NormalizedContactValue {
  return kind === "phone"
    ? normalizePhoneNumber(value, defaultPhoneRegion)
    : normalizeEmailAddress(value);
}

export function formatPhoneNumberForDisplay(canonicalValue: string, displayRegion: string): string {
  const phone = parsePhoneNumberFromString(canonicalValue);
  if (!phone?.isValid()) return canonicalValue;
  const region = normalizeDefaultPhoneRegion(displayRegion);
  return phone.country === region ? phone.formatNational() : phone.formatInternational();
}
