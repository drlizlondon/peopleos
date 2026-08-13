import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";
import { initWaitlist } from "./assets/waitlist.js";
import { WaitlistProviderError, waitlistProvider } from "./assets/waitlist-provider.js";

const root = dirname(fileURLToPath(import.meta.url));
const homepage = await readFile(join(root, "index.html"), "utf8");

async function settle() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

async function withHomepage(run) {
  const dom = new JSDOM(homepage, { url: "https://peopleos.vercel.app/" });
  const previousFormData = globalThis.FormData;
  globalThis.FormData = dom.window.FormData;

  try {
    await run(dom);
  } finally {
    globalThis.FormData = previousFormData;
    dom.window.close();
  }
}

test("waitlist submission shows synchronized inline success and stores the optional answer", async () => {
  await withHomepage(async (dom) => {
    const joins = [];
    const answers = [];
    const provider = {
      async join(payload) { joins.push(payload); },
      async answer(payload) { answers.push(payload); }
    };
    const controller = initWaitlist({
      provider,
      idFactory: () => "signup-reference-1",
      documentRoot: dom.window.document
    });

    const heroForm = dom.window.document.querySelector('[data-waitlist-source="hero"] [data-waitlist-form]');
    assert.equal(heroForm.hidden, false);
    assert.ok([...dom.window.document.querySelectorAll("[data-waitlist-loading]")]
      .every((loading) => loading.hidden));
    heroForm.querySelector('input[name="email"]').value = "  PERSON@Example.com ";
    heroForm.querySelector('input[name="first_name"]').value = " Liz ";
    heroForm.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await settle();

    assert.deepEqual(joins, [{
      email: "person@example.com",
      firstName: "Liz",
      honeypot: "",
      correlationId: "signup-reference-1",
      source: "hero"
    }]);

    const forms = [...dom.window.document.querySelectorAll("[data-waitlist-form]")];
    const successes = [...dom.window.document.querySelectorAll("[data-waitlist-success]")];
    assert.equal(forms.length, 2);
    assert.ok(forms.every((form) => form.hidden));
    assert.ok(successes.every((success) => !success.hidden));
    assert.equal(dom.window.document.activeElement.textContent.trim(), "You’re on the list.");
    assert.equal(dom.window.document.querySelector('[data-waitlist-source="hero"] [data-waitlist-question]').hidden, false);
    assert.equal(dom.window.document.querySelector('[data-waitlist-source="bottom"] [data-waitlist-question]').hidden, true);
    assert.equal(dom.window.document.querySelector('[data-waitlist-source="hero"] [data-waitlist-announcement]').getAttribute("role"), "status");
    assert.equal(dom.window.document.querySelector('[data-waitlist-source="bottom"] [data-waitlist-announcement]').hasAttribute("role"), false);

    dom.window.document.querySelector('[data-waitlist-source="hero"] [data-waitlist-answer="family"]').click();
    await settle();

    assert.deepEqual(answers, [{
      correlationId: "signup-reference-1",
      relationshipGap: "family",
      relationshipGapLabel: "Family",
      source: "hero",
      honeypot: ""
    }]);
    assert.equal(dom.window.document.querySelector('[data-waitlist-source="hero"] [data-waitlist-answer-status]').textContent,
      "Thanks — that’s really helpful.");
    assert.equal(dom.window.document.querySelector('[data-waitlist-source="bottom"] [data-waitlist-answer-status]').textContent, "");
    assert.ok([...dom.window.document.querySelectorAll('[data-waitlist-answer="family"]')]
      .every((button) => button.getAttribute("aria-pressed") === "true" && button.disabled));

    controller.destroy();
  });
});

test("a provider failure keeps the form usable and reports an inline error", async () => {
  await withHomepage(async (dom) => {
    const controller = initWaitlist({
      provider: {
        async join() { throw new Error("offline"); },
        async answer() {}
      },
      idFactory: () => "signup-reference-2",
      documentRoot: dom.window.document
    });

    const bottomRoot = dom.window.document.querySelector('[data-waitlist-source="bottom"]');
    const form = bottomRoot.querySelector("[data-waitlist-form]");
    form.querySelector('input[name="email"]').value = "person@example.com";
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await settle();

    assert.equal(form.hidden, false);
    assert.equal(form.querySelector("[data-waitlist-submit]").disabled, false);
    assert.equal(form.querySelector('input[name="email"]').hasAttribute("aria-invalid"), false);
    assert.match(bottomRoot.querySelector("[data-waitlist-error]").textContent, /couldn’t add you/i);

    controller.destroy();
  });
});

test("a provider rate limit keeps the form usable and asks the visitor to wait", async () => {
  await withHomepage(async (dom) => {
    const controller = initWaitlist({
      provider: {
        async join() { throw new WaitlistProviderError("limited", 429); },
        async answer() {}
      },
      idFactory: () => "signup-reference-3",
      documentRoot: dom.window.document
    });

    const heroRoot = dom.window.document.querySelector('[data-waitlist-source="hero"]');
    const form = heroRoot.querySelector("[data-waitlist-form]");
    form.querySelector('input[name="email"]').value = "person@example.com";
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await settle();

    assert.equal(form.hidden, false);
    assert.equal(form.querySelector("[data-waitlist-submit]").disabled, false);
    assert.match(heroRoot.querySelector("[data-waitlist-error]").textContent, /wait a moment/i);

    controller.destroy();
  });
});

test("the Formspree adapter keeps both events in one archive without duplicating email", async () => {
  const requests = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 200 };
  };

  try {
    await waitlistProvider.join({
      email: "person@example.com",
      firstName: "Liz",
      correlationId: "signup-reference-4",
      source: "hero",
      honeypot: ""
    });
    await waitlistProvider.answer({
      correlationId: "signup-reference-4",
      relationshipGap: "friends",
      relationshipGapLabel: "Friends",
      source: "hero",
      honeypot: ""
    });
  } finally {
    globalThis.fetch = previousFetch;
  }

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, requests[1].url);
  assert.match(requests[0].url, /^https:\/\/formspree\.io\/f\//);
  assert.equal(requests[0].options.credentials, "omit");

  const signup = JSON.parse(requests[0].options.body);
  const answer = JSON.parse(requests[1].options.body);
  assert.equal(signup.email, "person@example.com");
  assert.equal(signup.consent_scope, "peopleos_beta_and_launch_updates_only");
  assert.equal(answer.email, undefined);
  assert.equal(answer.correlation_id, signup.correlation_id);
  assert.equal(answer._gotcha, "");
  assert.equal(answer.submission_type, "waitlist_relationship_insight");
});

test("the Formspree adapter exposes non-success status codes", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 429 });

  try {
    await assert.rejects(
      waitlistProvider.join({
        email: "person@example.com",
        firstName: "",
        correlationId: "signup-reference-5",
        source: "bottom",
        honeypot: ""
      }),
      (error) => error instanceof WaitlistProviderError && error.status === 429
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});
