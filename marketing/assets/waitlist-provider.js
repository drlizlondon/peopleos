const FORM_ENDPOINT = "https://formspree.io/f/mrpzlgrl";

const CONSENT_VERSION = "2026-08-13";
const CONSENT_SCOPE = "peopleos_beta_and_launch_updates_only";

export class WaitlistProviderError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "WaitlistProviderError";
    this.status = status;
  }
}

async function post(endpoint, payload) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    credentials: "omit",
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new WaitlistProviderError("The waitlist provider rejected the submission.", response.status);
  }
}

export const waitlistProvider = Object.freeze({
  async join({ email, firstName, correlationId, source, honeypot }) {
    const payload = {
      email,
      correlation_id: correlationId,
      source,
      submission_type: "waitlist_signup",
      consent_scope: CONSENT_SCOPE,
      consent_version: CONSENT_VERSION,
      _gotcha: honeypot
    };

    if (firstName) payload.first_name = firstName;
    await post(FORM_ENDPOINT, payload);
  },

  async answer({ correlationId, relationshipGap, relationshipGapLabel, source, honeypot }) {
    await post(FORM_ENDPOINT, {
      correlation_id: correlationId,
      relationship_gap: relationshipGap,
      relationship_gap_label: relationshipGapLabel,
      source,
      submission_type: "waitlist_relationship_insight",
      _gotcha: honeypot
    });
  }
});
