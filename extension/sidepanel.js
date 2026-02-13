// Resume Tailor - Side Panel Logic

(function () {
  "use strict";

  const API_BASE = "http://localhost:3847";

  // ── DOM References ───────────────────────────────────

  const els = {
    // Sections
    inputSection: document.getElementById("input-section"),
    progressSection: document.getElementById("progress-section"),
    resultsSection: document.getElementById("results-section"),
    errorBanner: document.getElementById("error-banner"),

    // Inputs
    companyInput: document.getElementById("company-input"),
    titleInput: document.getElementById("title-input"),
    linkInput: document.getElementById("link-input"),
    descriptionInput: document.getElementById("description-input"),

    // Buttons
    extractBtn: document.getElementById("extract-btn"),
    clearBtn: document.getElementById("clear-btn"),
    generateBtn: document.getElementById("generate-btn"),
    newBtn: document.getElementById("new-btn"),
    copyEmailBtn: document.getElementById("copy-email-btn"),
    openResumeBtn: document.getElementById("open-resume-btn"),
    openCoverBtn: document.getElementById("open-cover-btn"),
    errorRetryBtn: document.getElementById("error-retry-btn"),
    errorDismissBtn: document.getElementById("error-dismiss-btn"),

    // Progress
    elapsedTime: document.getElementById("elapsed-time"),
    stepExtracting: document.getElementById("step-extracting"),
    stepGenerating: document.getElementById("step-generating"),
    stepCompiling: document.getElementById("step-compiling"),
    stepDone: document.getElementById("step-done"),

    // Results
    resumeFilename: document.getElementById("resume-filename"),
    coverFilename: document.getElementById("cover-filename"),
    emailDraft: document.getElementById("email-draft"),

    // Error
    errorMessage: document.getElementById("error-message"),
  };

  // ── State ────────────────────────────────────────────

  let pollingInterval = null;
  let elapsedInterval = null;
  let elapsedSeconds = 0;
  let currentJobId = null;
  const STORAGE_KEY = "savedFormData";

  // ── Persistence ────────────────────────────────────────

  function saveFields() {
    const data = {
      company: els.companyInput.value,
      title: els.titleInput.value,
      link: els.linkInput.value,
      description: els.descriptionInput.value,
    };
    chrome.storage.local.set({ [STORAGE_KEY]: data });
  }

  function loadFields() {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        const data = result[STORAGE_KEY];
        if (data) {
          if (data.company) els.companyInput.value = data.company;
          if (data.title) els.titleInput.value = data.title;
          if (data.link) els.linkInput.value = data.link;
          if (data.description) els.descriptionInput.value = data.description;
        }
        resolve(data);
      });
    });
  }

  // Auto-save on every keystroke so nothing is lost
  els.companyInput.addEventListener("input", saveFields);
  els.titleInput.addEventListener("input", saveFields);
  els.linkInput.addEventListener("input", saveFields);
  els.descriptionInput.addEventListener("input", saveFields);

  // ── Initialization ───────────────────────────────────

  document.addEventListener("DOMContentLoaded", async () => {
    // Restore saved fields first (so partial pastes survive popup close)
    await loadFields();

    // Then try extraction; only overwrite empty fields
    requestExtraction(true);

    // Also check for cached data from background auto-send
    chrome.storage.session.get("latestJobData", (result) => {
      if (result.latestJobData) {
        populateFields(result.latestJobData, true);
      }
    });
  });

  // Listen for job data messages relayed by the background script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "jobData" && message.data) {
      populateFields(message.data, true);
    }
  });

  // ── Event Listeners ──────────────────────────────────

  els.clearBtn.addEventListener("click", () => {
    els.companyInput.value = "";
    els.titleInput.value = "";
    els.linkInput.value = "";
    els.descriptionInput.value = "";
    chrome.storage.local.remove(STORAGE_KEY);
  });

  els.extractBtn.addEventListener("click", () => {
    requestExtraction(false);
  });

  els.generateBtn.addEventListener("click", () => {
    startGeneration();
  });

  els.newBtn.addEventListener("click", () => {
    resetToInitial();
  });

  els.copyEmailBtn.addEventListener("click", () => {
    copyEmailDraft();
  });

  els.openResumeBtn.addEventListener("click", () => {
    if (currentJobId) {
      window.open(`${API_BASE}/files/${currentJobId}/resume`, "_blank");
    }
  });

  els.openCoverBtn.addEventListener("click", () => {
    if (currentJobId) {
      window.open(`${API_BASE}/files/${currentJobId}/cover-letter`, "_blank");
    }
  });

  els.errorRetryBtn.addEventListener("click", () => {
    hideError();
    startGeneration();
  });

  els.errorDismissBtn.addEventListener("click", () => {
    hideError();
  });

  // ── Extraction ───────────────────────────────────────

  // gentle = true: only fill empty fields (don't overwrite user input)
  // gentle = false: overwrite everything (explicit "Extract" button click)
  function requestExtraction(gentle = false) {
    els.extractBtn.textContent = "Extracting...";
    els.extractBtn.disabled = true;

    chrome.runtime.sendMessage({ type: "extractFromPage" }, (response) => {
      els.extractBtn.textContent = "Extract from Page";
      els.extractBtn.disabled = false;

      if (chrome.runtime.lastError) {
        if (!gentle) showError("Could not connect to the page. Is the tab on a job posting?");
        return;
      }

      if (response?.error) {
        if (!gentle) showError(response.error);
        return;
      }

      if (response?.data) {
        populateFields(response.data, gentle);
      }
    });
  }

  // onlyEmpty: if true, skip fields that already have content
  function populateFields(data, onlyEmpty = false) {
    if (data.company && (!onlyEmpty || !els.companyInput.value.trim())) {
      els.companyInput.value = data.company;
    }
    if (data.title && (!onlyEmpty || !els.titleInput.value.trim())) {
      els.titleInput.value = data.title;
    }
    const link = data.link || data.url || "";
    if (link && (!onlyEmpty || !els.linkInput.value.trim())) {
      els.linkInput.value = link;
    }
    if (data.description && (!onlyEmpty || !els.descriptionInput.value.trim())) {
      els.descriptionInput.value = data.description;
    }
    saveFields();
  }

  // ── Generation ───────────────────────────────────────

  async function startGeneration() {
    const company = els.companyInput.value.trim();
    const title = els.titleInput.value.trim();
    const link = els.linkInput.value.trim();
    const description = els.descriptionInput.value.trim();

    // Validate
    if (!company || !title || !description) {
      showError("Please fill in all fields before generating.");
      return;
    }

    // Switch to progress view
    hideError();
    els.inputSection.classList.add("hidden");
    els.resultsSection.classList.add("hidden");
    els.progressSection.classList.remove("hidden");

    // Reset progress steps
    resetProgressSteps();
    setStepStatus("step-extracting", "active");

    // Start elapsed timer
    startElapsedTimer();

    try {
      // POST to generate
      const res = await fetch(`${API_BASE}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, title, link, description }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `Server responded with ${res.status}`);
      }

      const data = await res.json();
      currentJobId = data.jobId;

      // Move to generating step
      setStepStatus("step-extracting", "done");
      setStepStatus("step-generating", "active");

      // Start polling for status
      startPolling(currentJobId);
    } catch (err) {
      stopElapsedTimer();
      showError(err.message || "Failed to start generation. Is the server running?");
      els.progressSection.classList.add("hidden");
      els.inputSection.classList.remove("hidden");
    }
  }

  // ── Polling ──────────────────────────────────────────

  function startPolling(jobId) {
    pollingInterval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/status/${jobId}`);
        if (!res.ok) throw new Error(`Status check failed: ${res.status}`);

        const data = await res.json();
        handleStatusUpdate(data);
      } catch (err) {
        stopPolling();
        stopElapsedTimer();
        showError(err.message || "Lost connection to server.");
        els.progressSection.classList.add("hidden");
        els.inputSection.classList.remove("hidden");
      }
    }, 2000);
  }

  function stopPolling() {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  }

  function handleStatusUpdate(data) {
    const status = data.status;

    if (status === "processing" || status === "generating") {
      setStepStatus("step-extracting", "done");
      setStepStatus("step-generating", "active");
    } else if (status === "compiling") {
      setStepStatus("step-extracting", "done");
      setStepStatus("step-generating", "done");
      setStepStatus("step-compiling", "active");
    } else if (status === "review") {
      // Claude finished; review page opened in browser
      stopPolling();
      stopElapsedTimer();

      setStepStatus("step-extracting", "done");
      setStepStatus("step-generating", "done");
      setStepStatus("step-compiling", "done");
      setStepStatus("step-done", "done");

      setTimeout(() => showResults(data), 600);
    } else if (status === "complete" || status === "done") {
      stopPolling();
      stopElapsedTimer();

      setStepStatus("step-extracting", "done");
      setStepStatus("step-generating", "done");
      setStepStatus("step-compiling", "done");
      setStepStatus("step-done", "done");

      setTimeout(() => showResults(data), 600);
    } else if (status === "error" || status === "failed") {
      stopPolling();
      stopElapsedTimer();
      showError(data.message || "Generation failed on the server.");
      els.progressSection.classList.add("hidden");
      els.inputSection.classList.remove("hidden");
    }
  }

  // ── Results ──────────────────────────────────────────

  function showResults(data) {
    els.progressSection.classList.add("hidden");
    els.resultsSection.classList.remove("hidden");

    if (data.resumeFile) {
      els.resumeFilename.textContent = data.resumeFile;
    }
    if (data.coverLetterFile) {
      els.coverFilename.textContent = data.coverLetterFile;
    }
    if (data.emailDraft) {
      els.emailDraft.textContent = data.emailDraft;
    } else {
      els.emailDraft.textContent = "No email draft was generated.";
    }
  }

  // ── Timer ────────────────────────────────────────────

  function startElapsedTimer() {
    elapsedSeconds = 0;
    updateElapsedDisplay();
    elapsedInterval = setInterval(() => {
      elapsedSeconds++;
      updateElapsedDisplay();
    }, 1000);
  }

  function stopElapsedTimer() {
    if (elapsedInterval) {
      clearInterval(elapsedInterval);
      elapsedInterval = null;
    }
  }

  function updateElapsedDisplay() {
    const mins = Math.floor(elapsedSeconds / 60);
    const secs = elapsedSeconds % 60;
    if (mins > 0) {
      els.elapsedTime.textContent = `${mins}m ${secs}s elapsed`;
    } else {
      els.elapsedTime.textContent = `${secs}s elapsed`;
    }
  }

  // ── Progress Steps ───────────────────────────────────

  function setStepStatus(stepId, status) {
    const el = els[stepId] || document.getElementById(stepId);
    if (el) el.setAttribute("data-status", status);
  }

  function resetProgressSteps() {
    ["step-extracting", "step-generating", "step-compiling", "step-done"].forEach(
      (id) => setStepStatus(id, "pending")
    );
  }

  // ── Error ────────────────────────────────────────────

  function showError(msg) {
    els.errorMessage.textContent = msg;
    els.errorBanner.classList.remove("hidden");
  }

  function hideError() {
    els.errorBanner.classList.add("hidden");
  }

  // ── Copy ─────────────────────────────────────────────

  async function copyEmailDraft() {
    const text = els.emailDraft.textContent;
    try {
      await navigator.clipboard.writeText(text);
      const original = els.copyEmailBtn.textContent;
      els.copyEmailBtn.textContent = "Copied!";
      setTimeout(() => {
        els.copyEmailBtn.textContent = original;
      }, 1500);
    } catch {
      showError("Failed to copy to clipboard.");
    }
  }

  // ── Reset ────────────────────────────────────────────

  function resetToInitial() {
    stopPolling();
    stopElapsedTimer();
    hideError();
    currentJobId = null;

    els.companyInput.value = "";
    els.titleInput.value = "";
    els.linkInput.value = "";
    els.descriptionInput.value = "";
    els.emailDraft.textContent = "";
    chrome.storage.local.remove(STORAGE_KEY);

    els.resultsSection.classList.add("hidden");
    els.progressSection.classList.add("hidden");
    els.inputSection.classList.remove("hidden");

    resetProgressSteps();
  }
})();
