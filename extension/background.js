// Tailor - Background Service Worker

// Toggle sidebar when toolbar icon is clicked
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: "toggleSidebar" }).catch(() => {});
  }
});

// Relay messages between content scripts and the sidebar iframe
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "jobData" && sender.tab) {
    chrome.storage.session.set({ latestJobData: message.data }).catch(() => {});
    chrome.runtime.sendMessage(message).catch(() => {});
  }

  if (message.type === "extractFromPage") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "extract" }, (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({ error: "Could not reach content script." });
          } else {
            sendResponse(response);
          }
        });
      } else {
        sendResponse({ error: "No active tab found." });
      }
    });
    return true;
  }
});
