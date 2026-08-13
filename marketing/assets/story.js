(() => {
  const demo = document.querySelector("[data-product-demo]");
  const frames = [...document.querySelectorAll("[data-demo-frame]")];
  const selectors = [...document.querySelectorAll("[data-demo-select]")];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const starterNodes = [...document.querySelectorAll("[data-demo-starter]")];
  const anotherStarter = document.querySelector(".another-starter");
  const starters = [
    "Hi Dad, how have you been lately?",
    "Hey Dad, just thinking of you today.",
    "Hey Dad, what’s new with you?"
  ];
  let starterIndex = 0;

  if (anotherStarter) anotherStarter.disabled = false;
  anotherStarter?.addEventListener("click", () => {
    starterIndex = (starterIndex + 1) % starters.length;
    for (const node of starterNodes) {
      const isQuote = node.tagName === "BLOCKQUOTE";
      node.textContent = isQuote ? `“${starters[starterIndex]}”` : starters[starterIndex];
    }
  });

  if (!demo || frames.length === 0 || selectors.length !== frames.length || reducedMotion.matches) return;

  document.documentElement.classList.add("demo-enhanced");
  const moments = frames.map((frame) => frame.getAttribute("data-demo-frame"));
  let activeIndex = 0;
  let timer;
  let paused = false;

  const show = (index) => {
    activeIndex = (index + frames.length) % frames.length;
    const activeMoment = moments[activeIndex];
    for (const frame of frames) {
      const active = frame.getAttribute("data-demo-frame") === activeMoment;
      frame.classList.toggle("is-active", active);
      frame.setAttribute("aria-hidden", String(!active));
    }
    for (const selector of selectors) {
      const active = selector.getAttribute("data-demo-select") === activeMoment;
      selector.classList.toggle("is-active", active);
      selector.setAttribute("aria-pressed", String(active));
    }
  };

  const schedule = () => {
    window.clearInterval(timer);
    if (paused || document.hidden) return;
    timer = window.setInterval(() => show(activeIndex + 1), 1200);
  };

  for (const [index, selector] of selectors.entries()) {
    selector.addEventListener("click", () => {
      show(index);
      schedule();
    });
  }

  demo.addEventListener("mouseenter", () => { paused = true; schedule(); });
  demo.addEventListener("mouseleave", () => { paused = false; schedule(); });
  demo.addEventListener("focusin", () => { paused = true; schedule(); });
  demo.addEventListener("focusout", () => { paused = false; schedule(); });
  document.addEventListener("visibilitychange", schedule);

  show(0);
  schedule();
})();
