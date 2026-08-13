import { waitlistProvider } from "./waitlist-provider.js";

const JOIN_LABEL = "Join the iPhone beta waitlist";
const JOINING_LABEL = "Joining…";
const JOIN_ERROR = "We couldn’t add you just now. Please try again.";
const JOIN_RATE_LIMIT = "Lots of people are joining at once. Please wait a moment and try again.";
const ANSWER_SAVED = "Thanks — that’s really helpful.";
const ANSWER_ERROR = "You’re still on the list. We couldn’t save that answer, but you can try again.";

function correlationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `peopleos-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function value(formData, name) {
  return String(formData.get(name) || "").trim();
}

export function initWaitlist({
  provider = waitlistProvider,
  idFactory = correlationId,
  documentRoot = document
} = {}) {
  const roots = [...documentRoot.querySelectorAll("[data-waitlist-root]")];
  if (roots.length === 0) return { destroy() {} };

  documentRoot.documentElement?.classList.add("waitlist-enhanced");

  const forms = roots.map((root) => root.querySelector("[data-waitlist-form]")).filter(Boolean);
  const answerButtons = roots.flatMap((root) => [...root.querySelectorAll("[data-waitlist-answer]")]);
  const cleanups = [];
  const state = {
    joinStatus: "idle",
    answerStatus: "idle",
    signup: undefined,
    answer: undefined
  };

  for (const root of roots) {
    const loading = root.querySelector("[data-waitlist-loading]");
    const form = root.querySelector("[data-waitlist-form]");
    if (loading) loading.hidden = true;
    if (form) form.hidden = false;
  }

  function setJoinPending(pending) {
    for (const form of forms) {
      form.setAttribute("aria-busy", String(pending));
      const button = form.querySelector("[data-waitlist-submit]");
      if (!button) continue;
      button.disabled = pending;
      button.textContent = pending ? JOINING_LABEL : JOIN_LABEL;
    }
  }

  function clearErrors() {
    for (const root of roots) {
      const input = root.querySelector('input[name="email"]');
      const error = root.querySelector("[data-waitlist-error]");
      input?.removeAttribute("aria-invalid");
      if (!error) continue;
      error.textContent = "";
      error.hidden = true;
    }
  }

  function showJoinError(activeRoot, cause) {
    const error = activeRoot.querySelector("[data-waitlist-error]");
    if (!error) return;
    error.textContent = cause?.status === 429 ? JOIN_RATE_LIMIT : JOIN_ERROR;
    error.hidden = false;
  }

  function showJoined(activeRoot) {
    for (const root of roots) {
      const isActive = root === activeRoot;
      const form = root.querySelector("[data-waitlist-form]");
      const success = root.querySelector("[data-waitlist-success]");
      const announcement = root.querySelector("[data-waitlist-announcement]");
      const question = root.querySelector("[data-waitlist-question]");
      if (form) form.hidden = true;
      if (success) success.hidden = false;
      if (announcement) {
        if (isActive) {
          announcement.setAttribute("role", "status");
          announcement.setAttribute("aria-live", "polite");
        } else {
          announcement.removeAttribute("role");
          announcement.removeAttribute("aria-live");
        }
      }
      if (question) question.hidden = !isActive;
    }

    activeRoot.querySelector("[data-waitlist-success-title]")?.focus({ preventScroll: true });
  }

  function setAnswerState({ pending, selected, message, activeRoot }) {
    for (const button of answerButtons) {
      const isSelected = button.dataset.waitlistAnswer === selected;
      button.disabled = pending || state.answerStatus === "succeeded";
      button.setAttribute("aria-pressed", String(isSelected));
    }

    const status = activeRoot?.querySelector("[data-waitlist-answer-status]");
    if (status) status.textContent = message;
  }

  async function submitWaitlist(event) {
    event.preventDefault();
    if (state.joinStatus === "submitting" || state.signup) return;

    const form = event.currentTarget;
    const activeRoot = form.closest("[data-waitlist-root]");
    if (!activeRoot || !form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const formData = new FormData(form);
    const signup = {
      email: value(formData, "email").toLowerCase(),
      firstName: value(formData, "first_name"),
      honeypot: value(formData, "_gotcha"),
      correlationId: idFactory(),
      source: activeRoot.dataset.waitlistSource || "unknown"
    };

    state.joinStatus = "submitting";
    clearErrors();
    setJoinPending(true);

    try {
      await provider.join(signup);
      state.signup = signup;
      state.joinStatus = "succeeded";
      showJoined(activeRoot);
    } catch (error) {
      state.joinStatus = "error";
      showJoinError(activeRoot, error);
    } finally {
      setJoinPending(false);
    }
  }

  async function submitAnswer(event) {
    if (!state.signup || state.answerStatus === "submitting" || state.answerStatus === "succeeded") return;

    const button = event.currentTarget;
    const activeRoot = button.closest("[data-waitlist-root]");
    const relationshipGap = button.dataset.waitlistAnswer;
    if (!activeRoot || !relationshipGap) return;

    state.answerStatus = "submitting";
    setAnswerState({ pending: true, selected: relationshipGap, message: "Saving…", activeRoot });

    try {
      await provider.answer({
        correlationId: state.signup.correlationId,
        relationshipGap,
        relationshipGapLabel: button.textContent.trim(),
        source: state.signup.source,
        honeypot: state.signup.honeypot
      });
      state.answerStatus = "succeeded";
      state.answer = relationshipGap;
      setAnswerState({ pending: false, selected: relationshipGap, message: ANSWER_SAVED, activeRoot });
    } catch {
      state.answerStatus = "error";
      setAnswerState({ pending: false, selected: undefined, message: ANSWER_ERROR, activeRoot });
    }
  }

  for (const form of forms) {
    form.addEventListener("submit", submitWaitlist);
    cleanups.push(() => form.removeEventListener("submit", submitWaitlist));
  }

  for (const button of answerButtons) {
    button.addEventListener("click", submitAnswer);
    cleanups.push(() => button.removeEventListener("click", submitAnswer));
  }

  return {
    destroy() {
      for (const cleanup of cleanups) cleanup();
    }
  };
}

if (typeof document !== "undefined") initWaitlist();
