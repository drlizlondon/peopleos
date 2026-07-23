export type ContactHandoff = (href: string) => void | Promise<void>;

/**
 * Browser handoff boundary for telephone and email targets. Following an
 * external link is deliberately not evidence that contact happened.
 */
export const openContactHandoff: ContactHandoff = (href) => {
  const link = document.createElement("a");
  link.href = href;
  link.rel = "external";
  link.click();
};
