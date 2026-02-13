// Resume Tailor - Content Script
// Extracts job data from supported job board pages.

(function () {
  "use strict";

  // Site-specific selector configurations
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
      company: null, // parsed from <title>
      title: "h1.app-title",
    },
    lever: {
      hostname: "lever.co",
      description: ".posting-page .content",
      company: ".posting-headline .company-name",
      title: ".posting-headline h2",
    },
  };

  /**
   * Detect which job site we are on based on hostname.
   * Returns the config object or null if unrecognized.
   */
  function detectSite() {
    const host = window.location.hostname.toLowerCase();
    for (const [key, config] of Object.entries(SITE_CONFIGS)) {
      if (host.includes(config.hostname)) {
        return { name: key, ...config };
      }
    }
    return null;
  }

  /**
   * Safely extract innerText from a selector, returning empty string on failure.
   */
  function getText(selector) {
    if (!selector) return "";
    const el = document.querySelector(selector);
    return el ? el.innerText.trim() : "";
  }

  /**
   * Extract job data from the current page.
   */
  function extractJobData() {
    const site = detectSite();

    if (site) {
      let company = getText(site.company);
      const title = getText(site.title);
      const description = getText(site.description);

      // Greenhouse special case: parse company from <title> tag
      if (site.name === "greenhouse" && !company) {
        const titleTag = document.title || "";
        // Greenhouse titles are typically "Job Title at Company Name"
        const atMatch = titleTag.match(/at\s+(.+?)(?:\s*[-|]|$)/i);
        if (atMatch) {
          company = atMatch[1].trim();
        }
      }

      return {
        source: site.name,
        company,
        title,
        description,
        url: window.location.href,
      };
    }

    // Fallback for unrecognized sites: use selected text
    const selectedText = window.getSelection().toString().trim();
    return {
      source: "manual",
      company: "",
      title: "",
      description: selectedText,
      url: window.location.href,
    };
  }

  // Listen for extraction requests from the side panel (via background)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "extract") {
      const data = extractJobData();
      sendResponse({ type: "jobData", data });
    }
  });

  // Auto-send job data on page load (after a short delay for dynamic content)
  setTimeout(() => {
    const data = extractJobData();
    if (data.description || data.title || data.company) {
      chrome.runtime.sendMessage({ type: "jobData", data }).catch(() => {
        // Side panel or background not ready; that is fine
      });
    }
  }, 1500);
})();
