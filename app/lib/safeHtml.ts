// Product descriptions come from the admin rich-text editor as HTML.
// Keep only simple formatting tags and safe links before rendering them.

const ALLOWED_TAGS = new Set([
  "B", "STRONG", "I", "EM", "U", "S", "BR", "P", "DIV", "SPAN",
  "H2", "H3", "H4", "UL", "OL", "LI", "BLOCKQUOTE", "CODE", "PRE", "A", "HR",
]);

function cleanNode(node: Node, doc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent || "");
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const element = node as Element;
  const children = Array.from(element.childNodes).map((child) => cleanNode(child, doc)).filter(Boolean) as Node[];
  if (!ALLOWED_TAGS.has(element.tagName)) {
    // Drop scripts/styles entirely; unwrap any other unknown tag but keep its text.
    if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "NOSCRIPT"].includes(element.tagName)) return null;
    const fragment = doc.createDocumentFragment();
    children.forEach((child) => fragment.appendChild(child));
    return fragment;
  }
  const clean = doc.createElement(element.tagName.toLowerCase());
  if (element.tagName === "A") {
    const href = (element.getAttribute("href") || "").trim();
    if (/^(https?:|mailto:)/i.test(href)) {
      clean.setAttribute("href", href);
      clean.setAttribute("target", "_blank");
      clean.setAttribute("rel", "noopener noreferrer nofollow");
    }
  }
  children.forEach((child) => clean.appendChild(child));
  return clean;
}

export function sanitizeRichText(html: string): string {
  if (!html || typeof window === "undefined" || typeof DOMParser === "undefined") return "";
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const out = document.implementation.createHTMLDocument("");
  const container = out.createElement("div");
  Array.from(parsed.body.childNodes).forEach((child) => {
    const clean = cleanNode(child, out);
    if (clean) container.appendChild(clean);
  });
  return container.innerHTML;
}

export function richTextToPlain(html: string): string {
  return (html || "").replace(/<br\s*\/?>/gi, " ").replace(/<\/(p|div|li|h\d)>/gi, " ").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
