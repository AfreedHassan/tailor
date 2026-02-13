// Tailor - Content Script
// Injects a persistent sidebar tab + iframe panel into web pages.
// Also handles job data extraction from supported job boards.

(function () {
  "use strict";

  const SIDEBAR_WIDTH = 420;
  const TAB_WIDTH = 32;
  const ACCENT = "#ff8a80";

  // ── Site-specific selector configurations ──────────────

  const SITE_CONFIGS = {
    linkedin: {
      hostname: "linkedin.com",
      description: ".jobs-description__content",
      company: ".jobs-unified-top-card__company-name",
      title: ".jobs-unified-top-card__job-title",
    },
    indeed: {
      hostname: "indeed.com",
      description: "#jobDescriptionText",
      company: "[data-company-name]",
      title: ".jobsearch-JobInfoHeader-title",
    },
    greenhouse: {
      hostname: "greenhouse.io",
      description: "#content .body",
      company: null,
      title: "h1.app-title",
    },
    lever: {
      hostname: "lever.co",
      description: ".posting-page .content",
      company: ".posting-headline .company-name",
      title: ".posting-headline h2",
    },
  };

  function detectSite() {
    const host = window.location.hostname.toLowerCase();
    for (const [key, config] of Object.entries(SITE_CONFIGS)) {
      if (host.includes(config.hostname)) return { name: key, ...config };
    }
    return null;
  }

  function getText(selector) {
    if (!selector) return "";
    const el = document.querySelector(selector);
    return el ? el.innerText.trim() : "";
  }

  function extractJobData() {
    const site = detectSite();
    if (site) {
      let company = getText(site.company);
      const title = getText(site.title);
      const description = getText(site.description);
      if (site.name === "greenhouse" && !company) {
        const titleTag = document.title || "";
        const atMatch = titleTag.match(/at\s+(.+?)(?:\s*[-|]|$)/i);
        if (atMatch) company = atMatch[1].trim();
      }
      return { source: site.name, company, title, description, url: window.location.href };
    }
    const selectedText = window.getSelection().toString().trim();
    return { source: "manual", company: "", title: "", description: selectedText, url: window.location.href };
  }

  // ── Sidebar injection ─────────────────────────────────

  // Prevent double-injection
  if (document.getElementById("tailor-sidebar-host")) return;

  // Use a shadow DOM host to isolate from page styles
  const host = document.createElement("div");
  host.id = "tailor-sidebar-host";
  host.style.cssText = "all: initial; position: fixed; top: 0; right: 0; height: 100vh; z-index: 2147483647; pointer-events: none;";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "closed" });

  // Inject styles into shadow DOM
  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    .container {
      position: fixed;
      top: 0;
      right: 0;
      height: 100vh;
      display: flex;
      flex-direction: row;
      pointer-events: none;
      z-index: 2147483647;
    }
    .tab {
      width: ${TAB_WIDTH}px;
      height: 80px;
      background: #111111;
      border: 1px solid #262626;
      border-right: none;
      border-radius: 6px 0 0 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      pointer-events: auto;
      writing-mode: vertical-rl;
      text-orientation: mixed;
      font-size: 11px;
      font-weight: 600;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #a3a3a3;
      letter-spacing: 0.05em;
      user-select: none;
      transition: background 200ms, border-color 200ms, color 200ms;
      align-self: center;
      box-shadow: -2px 0 8px rgba(0,0,0,0.3);
    }
    .tab:hover {
      border-color: ${ACCENT};
      color: ${ACCENT};
    }
    .tab.open {
      border-color: ${ACCENT};
      color: ${ACCENT};
    }
    .tab .accent {
      color: ${ACCENT};
    }
    .panel {
      width: 0px;
      height: 100%;
      overflow: hidden;
      transition: width 250ms ease;
      pointer-events: auto;
      box-shadow: -4px 0 20px rgba(0,0,0,0.4);
      background: #0a0a0a;
      border-left: 1px solid #262626;
    }
    .panel.open {
      width: ${SIDEBAR_WIDTH}px;
    }
    .panel iframe {
      width: ${SIDEBAR_WIDTH}px;
      height: 100%;
      border: none;
      background: #0a0a0a;
    }
  `;
  shadow.appendChild(style);

  // Container
  const container = document.createElement("div");
  container.className = "container";

  // Tab
  const tab = document.createElement("div");
  tab.className = "tab";
  tab.innerHTML = '<span class="accent">//</span>&nbsp;Tailor';
  tab.addEventListener("click", () => toggleSidebar());

  // Panel
  const panel = document.createElement("div");
  panel.className = "panel";

  const iframe = document.createElement("iframe");
  iframe.src = chrome.runtime.getURL("sidepanel.html");
  panel.appendChild(iframe);

  container.appendChild(tab);
  container.appendChild(panel);
  shadow.appendChild(container);

  // ── Toggle logic ───────────────────────────────────────

  let sidebarOpen = false;

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    panel.classList.toggle("open", sidebarOpen);
    tab.classList.toggle("open", sidebarOpen);
  }

  // ── Message handling ───────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "toggleSidebar") {
      toggleSidebar();
    }
    if (message.type === "extract") {
      const data = extractJobData();
      sendResponse({ type: "jobData", data });
    }
  });

  // Auto-send job data on page load
  setTimeout(() => {
    const data = extractJobData();
    if (data.description || data.title || data.company) {
      chrome.runtime.sendMessage({ type: "jobData", data }).catch(() => {});
    }
  }, 1500);
})();
