export const MAX_VCARD_BYTES = 5 * 1024 * 1024;
export const MAX_VCARD_CARDS = 5_000;

export type SupportedVCardVersion = "3.0" | "4.0";

export type VCardParseErrorCode =
  | "file_too_large"
  | "invalid_utf8"
  | "malformed_structure"
  | "malformed_property"
  | "too_many_cards"
  | "unsupported_version"
  | "unsupported_encoding"
  | "unsupported_charset";

export class VCardParseError extends Error {
  constructor(
    public readonly code: VCardParseErrorCode,
    message: string,
    public readonly cardIndex?: number,
    public readonly lineNumber?: number
  ) {
    super(message);
    this.name = "VCardParseError";
  }
}

export type ParsedVCardContactMethod = {
  kind: "phone" | "email";
  /** The decoded value exactly as represented by the vCard property. */
  rawValue: string;
  /** A value suitable for the existing contact-value normaliser. */
  value: string;
  label?: string;
  types: string[];
  isPreferred: boolean;
};

export type ParsedVCard = {
  sourceIndex: number;
  version: SupportedVCardVersion;
  displayName: string;
  phoneNumbers: ParsedVCardContactMethod[];
  emailAddresses: ParsedVCardContactMethod[];
  organisation?: string;
  title?: string;
};

type ParsedProperty = {
  group?: string;
  name: string;
  parameters: Map<string, string[]>;
  rawValue: string;
  lineNumber: number;
};

type OpenCard = {
  sourceIndex: number;
  properties: ParsedProperty[];
};

function splitOutsideQuotes(value: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;

  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (character === "\"") {
      current += character;
      quoted = !quoted;
      continue;
    }
    if (character === separator && !quoted) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }

  parts.push(current);
  return parts;
}

function findValueDelimiter(line: string): number {
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "\"") {
      quoted = !quoted;
      continue;
    }
    if (character === ":" && !quoted) return index;
  }

  return -1;
}

function stripOuterQuotes(value: string): string {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")
    ? trimmed.slice(1, -1)
    : trimmed;
}

function decodeParameterValue(value: string): string {
  return value
    .replace(/\^n/gi, "\n")
    .replace(/\^'/g, "\"")
    .replace(/\^\^/g, "^");
}

function parseProperty(line: string, lineNumber: number, cardIndex?: number): ParsedProperty {
  const delimiter = findValueDelimiter(line);
  if (delimiter <= 0) {
    throw new VCardParseError(
      "malformed_property",
      `The vCard contains a malformed property on line ${lineNumber}.`,
      cardIndex,
      lineNumber
    );
  }

  const declaration = line.slice(0, delimiter);
  const segments = splitOutsideQuotes(declaration, ";");
  const nameWithGroup = segments.shift()?.trim() ?? "";
  const groupDelimiter = nameWithGroup.lastIndexOf(".");
  const group = groupDelimiter >= 0 ? nameWithGroup.slice(0, groupDelimiter) : undefined;
  const name = nameWithGroup.slice(groupDelimiter + 1).trim().toUpperCase();
  if (!name) {
    throw new VCardParseError(
      "malformed_property",
      `The vCard contains a property without a name on line ${lineNumber}.`,
      cardIndex,
      lineNumber
    );
  }

  const parameters = new Map<string, string[]>();
  for (const segment of segments) {
    if (!segment.trim()) continue;
    const equals = segment.indexOf("=");
    const key = (equals < 0 ? "TYPE" : segment.slice(0, equals)).trim().toUpperCase();
    const encodedValues = equals < 0 ? segment : segment.slice(equals + 1);
    const unquotedValues = stripOuterQuotes(encodedValues);
    const values = splitOutsideQuotes(unquotedValues, ",")
      .map((entry) => decodeParameterValue(stripOuterQuotes(entry)))
      .filter(Boolean);
    parameters.set(key, [...(parameters.get(key) ?? []), ...values]);
  }

  return {
    ...(group ? { group } : {}),
    name,
    parameters,
    rawValue: line.slice(delimiter + 1),
    lineNumber
  };
}

function isQuotedPrintableDeclaration(line: string): boolean {
  const delimiter = findValueDelimiter(line);
  const declaration = delimiter >= 0 ? line.slice(0, delimiter) : line;
  return /(?:^|;)ENCODING\s*=\s*"?QUOTED-PRINTABLE"?(?:;|$)/i.test(declaration);
}

function unfoldLines(text: string): Array<{ value: string; lineNumber: number }> {
  const physicalLines = text.replace(/\r\n?/g, "\n").split("\n");
  const logicalLines: Array<{ value: string; lineNumber: number }> = [];

  for (let index = 0; index < physicalLines.length; index += 1) {
    const value = physicalLines[index];
    const previous = logicalLines[logicalLines.length - 1];
    if (previous && isQuotedPrintableDeclaration(previous.value) && previous.value.endsWith("=")) {
      previous.value = previous.value.slice(0, -1) + value.replace(/^[ \t]/, "");
      continue;
    }
    if (previous && /^[ \t]/.test(value)) {
      previous.value += value.slice(1);
      continue;
    }
    logicalLines.push({ value, lineNumber: index + 1 });
  }

  return logicalLines;
}

function assertSupportedPropertyParameters(property: ParsedProperty, cardIndex: number): void {
  const encodings = property.parameters.get("ENCODING");
  if (encodings && (!encodings.length || encodings.some((value) => value.trim().toUpperCase() !== "QUOTED-PRINTABLE"))) {
    const encoding = encodings.map((value) => value.trim()).filter(Boolean).join(", ") || "an empty value";
    throw new VCardParseError(
      "unsupported_encoding",
      `Card ${cardIndex + 1} uses unsupported encoding ${encoding} on line ${property.lineNumber}.`,
      cardIndex,
      property.lineNumber
    );
  }

  const charsets = property.parameters.get("CHARSET");
  if (charsets && (!charsets.length || charsets.some((value) => {
    const charset = value.trim().toUpperCase();
    return charset !== "UTF-8" && charset !== "UTF8";
  }))) {
    const charset = charsets.map((value) => value.trim()).filter(Boolean).join(", ") || "an empty value";
    throw new VCardParseError(
      "unsupported_charset",
      `Card ${cardIndex + 1} uses unsupported charset ${charset} on line ${property.lineNumber}.`,
      cardIndex,
      property.lineNumber
    );
  }
}

function decodeQuotedPrintable(value: string, property: ParsedProperty, cardIndex: number): string {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let index = 0; index < value.length;) {
    const match = value.slice(index).match(/^=([0-9A-Fa-f]{2})/);
    if (match) {
      bytes.push(Number.parseInt(match[1], 16));
      index += 3;
      continue;
    }
    const [character] = Array.from(value.slice(index));
    bytes.push(...encoder.encode(character));
    index += character.length;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    throw new VCardParseError(
      "invalid_utf8",
      `Card ${cardIndex + 1} contains invalid quoted-printable UTF-8.`,
      cardIndex,
      property.lineNumber
    );
  }
}

function decodedPropertyValue(property: ParsedProperty, cardIndex: number): string {
  const encoding = property.parameters.get("ENCODING")?.[0]?.trim().toUpperCase();
  if (!encoding) return property.rawValue;
  return decodeQuotedPrintable(property.rawValue, property, cardIndex);
}

function unescapeText(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "\\" || index === value.length - 1) {
      result += value[index];
      continue;
    }
    const next = value[index + 1];
    if (next === "n" || next === "N") result += "\n";
    else result += next;
    index += 1;
  }
  return result;
}

function splitEscaped(value: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      current += `\\${character}`;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === separator) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (escaped) current += "\\";
  parts.push(current);
  return parts;
}

function textValue(property: ParsedProperty, cardIndex: number): string {
  return unescapeText(decodedPropertyValue(property, cardIndex)).trim();
}

function structuredValues(property: ParsedProperty, cardIndex: number): string[] {
  return splitEscaped(decodedPropertyValue(property, cardIndex), ";")
    .map((value) => unescapeText(value).trim());
}

function displayNameFromStructuredName(property: ParsedProperty, cardIndex: number): string {
  const [family, given, additional, prefix, suffix] = structuredValues(property, cardIndex);
  return [prefix, given, additional, family, suffix].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function normaliseAppleLabel(value: string): string {
  const trimmed = value.trim();
  const appleLabel = trimmed.match(/^_\$!<(.+)>!\$_$/);
  return appleLabel?.[1]?.trim() || trimmed;
}

function humaniseType(type: string): string {
  return type
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function labelFromTypes(types: string[]): string | undefined {
  const meaningful = types.filter((type) => !["voice", "internet", "pref"].includes(type));
  if (!meaningful.length) return undefined;
  const values = new Set(meaningful);
  if (values.has("work") && values.has("cell")) return "Work mobile";
  if (values.has("home") && values.has("cell")) return "Home mobile";
  if (values.size === 1 && values.has("cell")) return "Mobile";
  return meaningful.map(humaniseType).join(" · ");
}

function contactMethodFromProperty(
  property: ParsedProperty,
  cardIndex: number,
  groupLabels: Map<string, string>
): ParsedVCardContactMethod {
  const rawValue = textValue(property, cardIndex);
  const types = [...new Set((property.parameters.get("TYPE") ?? [])
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean))];
  const explicitLabel = property.group ? groupLabels.get(property.group.toLowerCase()) : undefined;
  const preference = property.parameters.get("PREF")?.[0];
  const isPreferred = types.includes("pref") || (preference !== undefined && Number(preference) === 1);
  const value = property.name === "TEL" && /^tel:/i.test(rawValue)
    ? rawValue.slice(rawValue.indexOf(":") + 1)
    : rawValue;

  return {
    kind: property.name === "TEL" ? "phone" : "email",
    rawValue,
    value,
    ...(explicitLabel || labelFromTypes(types) ? { label: explicitLabel ?? labelFromTypes(types) } : {}),
    types,
    isPreferred
  };
}

function parseCard(card: OpenCard): ParsedVCard {
  // The file has already been decoded as UTF-8. Validate every property,
  // including ignored extension properties, so unsupported declarations can
  // never be silently treated as readable text.
  card.properties.forEach((property) => {
    assertSupportedPropertyParameters(property, card.sourceIndex);
  });

  const versionProperties = card.properties.filter((property) => property.name === "VERSION");
  const version = versionProperties.length === 1
    ? textValue(versionProperties[0], card.sourceIndex)
    : undefined;
  if (version !== "3.0" && version !== "4.0") {
    throw new VCardParseError(
      "unsupported_version",
      `Card ${card.sourceIndex + 1} must declare VERSION 3.0 or 4.0.`,
      card.sourceIndex,
      versionProperties[0]?.lineNumber
    );
  }

  const groupLabels = new Map<string, string>();
  for (const property of card.properties) {
    if (property.group && property.name === "X-ABLABEL") {
      groupLabels.set(
        property.group.toLowerCase(),
        normaliseAppleLabel(textValue(property, card.sourceIndex))
      );
    }
  }

  const formattedName = card.properties
    .filter((property) => property.name === "FN")
    .map((property) => textValue(property, card.sourceIndex))
    .find(Boolean);
  const structuredName = card.properties
    .filter((property) => property.name === "N")
    .map((property) => displayNameFromStructuredName(property, card.sourceIndex))
    .find(Boolean);
  const organisationProperty = card.properties.find((property) => property.name === "ORG");
  const organisation = organisationProperty
    ? structuredValues(organisationProperty, card.sourceIndex).find(Boolean)
    : undefined;
  const titleProperty = card.properties.find((property) => property.name === "TITLE");
  const title = titleProperty ? textValue(titleProperty, card.sourceIndex) : undefined;

  const contactMethods = card.properties
    .filter((property) => property.name === "TEL" || property.name === "EMAIL")
    .map((property) => contactMethodFromProperty(property, card.sourceIndex, groupLabels));

  return {
    sourceIndex: card.sourceIndex,
    version,
    displayName: formattedName ?? structuredName ?? "",
    phoneNumbers: contactMethods.filter((method) => method.kind === "phone"),
    emailAddresses: contactMethods.filter((method) => method.kind === "email"),
    ...(organisation ? { organisation } : {}),
    ...(title ? { title } : {})
  };
}

function decodeInput(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > MAX_VCARD_BYTES) {
    throw new VCardParseError(
      "file_too_large",
      `Choose a vCard file no larger than ${MAX_VCARD_BYTES} bytes.`
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new VCardParseError("invalid_utf8", "The vCard file must use valid UTF-8 text.");
  }
}

export function parseVCard(input: ArrayBuffer | Uint8Array): ParsedVCard[] {
  const text = decodeInput(input);
  const lines = unfoldLines(text);
  const cards: OpenCard[] = [];
  let openCard: OpenCard | undefined;

  for (const line of lines) {
    if (!line.value.trim()) continue;
    if (!openCard && !/^(?:BEGIN|END):VCARD\s*$/i.test(line.value.trim())) {
      throw new VCardParseError(
        "malformed_structure",
        "The vCard file contains content outside a BEGIN:VCARD and END:VCARD pair.",
        undefined,
        line.lineNumber
      );
    }
    const property = parseProperty(line.value, line.lineNumber, openCard?.sourceIndex);
    const markerValue = property.rawValue.trim().toUpperCase();

    if (property.name === "BEGIN" && markerValue === "VCARD") {
      if (openCard) {
        throw new VCardParseError(
          "malformed_structure",
          "The vCard file contains a nested BEGIN:VCARD marker.",
          openCard.sourceIndex,
          line.lineNumber
        );
      }
      if (cards.length >= MAX_VCARD_CARDS) {
        throw new VCardParseError(
          "too_many_cards",
          `Choose a vCard file containing no more than ${MAX_VCARD_CARDS} cards.`,
          cards.length,
          line.lineNumber
        );
      }
      openCard = { sourceIndex: cards.length, properties: [] };
      continue;
    }

    if (property.name === "END" && markerValue === "VCARD") {
      if (!openCard) {
        throw new VCardParseError(
          "malformed_structure",
          "The vCard file contains END:VCARD without a matching BEGIN:VCARD.",
          undefined,
          line.lineNumber
        );
      }
      cards.push(openCard);
      openCard = undefined;
      continue;
    }

    if (!openCard) {
      throw new VCardParseError(
        "malformed_structure",
        "The vCard file contains content outside a BEGIN:VCARD and END:VCARD pair.",
        undefined,
        line.lineNumber
      );
    }
    if (property.name === "BEGIN" || property.name === "END") {
      throw new VCardParseError(
        "malformed_structure",
        `The vCard file contains an unsupported ${property.name} marker.`,
        openCard.sourceIndex,
        line.lineNumber
      );
    }
    openCard.properties.push(property);
  }

  if (openCard) {
    throw new VCardParseError(
      "malformed_structure",
      "The vCard file ends before END:VCARD.",
      openCard.sourceIndex
    );
  }

  return cards.map(parseCard);
}
