import { describe, expect, it } from "vitest";
import {
  MAX_VCARD_BYTES,
  MAX_VCARD_CARDS,
  parseVCard,
  VCardParseError
} from "./vcard";

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

function card(name: string, version = "4.0"): string {
  return `BEGIN:VCARD\nVERSION:${version}\nFN:${name}\nEND:VCARD\n`;
}

function expectParseError(input: Uint8Array, code: VCardParseError["code"]): void {
  try {
    parseVCard(input);
    throw new Error("Expected vCard parsing to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(VCardParseError);
    expect((error as VCardParseError).code).toBe(code);
  }
}

describe("vCard parser", () => {
  it("accepts ArrayBuffer input and preserves cards in source order", () => {
    const bytes = encode(`${card("First", "3.0")}${card("Second", "4.0")}`);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    expect(parseVCard(buffer).map(({ displayName, version, sourceIndex }) => ({
      displayName,
      version,
      sourceIndex
    }))).toEqual([
      { displayName: "First", version: "3.0", sourceIndex: 0 },
      { displayName: "Second", version: "4.0", sourceIndex: 1 }
    ]);
  });

  it("returns an empty result for an empty or whitespace-only file", () => {
    expect(parseVCard(encode(""))).toEqual([]);
    expect(parseVCard(encode("\r\n  \r\n"))).toEqual([]);
  });

  it("uses structured N as a deterministic fallback when FN is absent", () => {
    const result = parseVCard(encode([
      "BEGIN:VCARD",
      "VERSION:4.0",
      "N:Doe;Jane;Alex;Dr;MBE",
      "END:VCARD"
    ].join("\r\n")));

    expect(result[0].displayName).toBe("Dr Jane Alex Doe MBE");
  });

  it("parses group-prefixed methods, labels, parameters and tel URIs", () => {
    const result = parseVCard(encode([
      "BEGIN:VCARD",
      "VERSION:4.0",
      "FN:Aaron Patel",
      "item1.TEL;VALUE=uri;TYPE=WORK,CELL;PREF=1:tel:+447900123456",
      "item1.X-ABLabel:_$!<NHS mobile>!$_",
      "TEL;TYPE=HOME,VOICE:020 7946 0000",
      "EMAIL;TYPE=\"WORK,INTERNET\":Aaron.Patel@Example.COM",
      "EMAIL;TYPE=HOME:aaron@example.net",
      "ORG:Watford NHS Trust",
      "TITLE:Chief Information Officer",
      "END:VCARD"
    ].join("\r\n")));

    expect(result[0]).toMatchObject({
      displayName: "Aaron Patel",
      organisation: "Watford NHS Trust",
      title: "Chief Information Officer",
      phoneNumbers: [
        {
          rawValue: "tel:+447900123456",
          value: "+447900123456",
          label: "NHS mobile",
          types: ["work", "cell"],
          isPreferred: true
        },
        {
          rawValue: "020 7946 0000",
          value: "020 7946 0000",
          label: "Home",
          types: ["home", "voice"],
          isPreferred: false
        }
      ],
      emailAddresses: [
        {
          rawValue: "Aaron.Patel@Example.COM",
          value: "Aaron.Patel@Example.COM",
          label: "Work",
          types: ["work", "internet"],
          isPreferred: false
        },
        {
          rawValue: "aaron@example.net",
          value: "aaron@example.net",
          label: "Home",
          types: ["home"],
          isPreferred: false
        }
      ]
    });
  });

  it("unfolds CRLF and LF lines and decodes escaped text", () => {
    const result = parseVCard(encode([
      "BEGIN:VCARD\r",
      "VERSION:4.0\r",
      "FN:Jane\\, Doe\r",
      "ORG:HealthTech\\; Labs;Simu\r",
      " lation Unit\r",
      "TITLE:Clinical\\nAdvisor\r",
      "X-IGNORED:anything\r",
      "END:VCARD\r"
    ].join("\n")));

    expect(result[0]).toMatchObject({
      displayName: "Jane, Doe",
      organisation: "HealthTech; Labs",
      title: "Clinical\nAdvisor"
    });
  });

  it("decodes representative UTF-8 quoted-printable vCard 3 properties and soft breaks", () => {
    const result = parseVCard(encode([
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Andr=C3=A9=20=",
      " Silva",
      "ORG;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:NHS=20Trust",
      "END:VCARD"
    ].join("\r\n")));

    expect(result[0]).toMatchObject({
      displayName: "André Silva",
      organisation: "NHS Trust"
    });
  });

  it.each(["B", "BASE64", "8BIT"])(
    "rejects unsupported %s encoding instead of treating it as readable text",
    (encoding) => {
      expectParseError(encode([
        "BEGIN:VCARD",
        "VERSION:3.0",
        `FN;ENCODING=${encoding}:U2FyYWg=`,
        "END:VCARD"
      ].join("\r\n")), "unsupported_encoding");
    }
  );

  it("rejects non-UTF-8 charset declarations on used and ignored properties", () => {
    expectParseError(encode([
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN;CHARSET=ISO-8859-1:Andre",
      "END:VCARD"
    ].join("\r\n")), "unsupported_charset");

    expectParseError(encode([
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Andre",
      "X-IGNORED;CHARSET=US-ASCII:anything",
      "END:VCARD"
    ].join("\r\n")), "unsupported_charset");
  });

  it("rejects invalid UTF-8 before parsing", () => {
    expectParseError(new Uint8Array([0x42, 0x45, 0x47, 0x49, 0x4e, 0x3a, 0xc3, 0x28]), "invalid_utf8");
  });

  it("rejects unsupported, missing and mixed versions for the whole file", () => {
    expectParseError(encode(card("Old", "2.1")), "unsupported_version");
    expectParseError(encode("BEGIN:VCARD\nFN:Missing version\nEND:VCARD\n"), "unsupported_version");
    expectParseError(encode(`${card("Supported")}${card("Unsupported", "2.1")}`), "unsupported_version");
  });

  it.each([
    "END:VCARD\n",
    "BEGIN:VCARD\nVERSION:4.0\nFN:Unclosed\n",
    "BEGIN:VCARD\nVERSION:4.0\nBEGIN:VCARD\nFN:Nested\nEND:VCARD\nEND:VCARD\n",
    "outside\nBEGIN:VCARD\nVERSION:4.0\nFN:Person\nEND:VCARD\n"
  ])("rejects structurally unbalanced input", (input) => {
    expectParseError(encode(input), "malformed_structure");
  });

  it("accepts exactly 5 MiB and rejects one byte more without a committed fixture", () => {
    const prefix = "BEGIN:VCARD\nVERSION:4.0\nFN:Boundary\nX-PADDING:";
    const suffix = "\nEND:VCARD\n";
    const paddingLength = MAX_VCARD_BYTES - encode(prefix + suffix).byteLength;
    const exact = encode(`${prefix}${"x".repeat(paddingLength)}${suffix}`);

    expect(exact.byteLength).toBe(MAX_VCARD_BYTES);
    expect(parseVCard(exact)[0].displayName).toBe("Boundary");
    expectParseError(new Uint8Array(MAX_VCARD_BYTES + 1), "file_too_large");
  });

  it("accepts exactly 5,000 cards and rejects the next card", () => {
    const exact = encode(Array.from({ length: MAX_VCARD_CARDS }, (_, index) => card(`Person ${index}`)).join(""));
    const excessive = encode(`${new TextDecoder().decode(exact)}${card("One too many")}`);

    expect(parseVCard(exact)).toHaveLength(MAX_VCARD_CARDS);
    expectParseError(excessive, "too_many_cards");
  });
});
