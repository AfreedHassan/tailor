// Resume Tailor - Background Service Worker

// Relay messages between content scripts and the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "jobData" && sender.tab) {
    // Content script sent job data; forward to any listening side panel
    // Store latest data so the side panel can retrieve it
    chrome.storage.session.set({ latestJobData: message.data }).catch(() => {});
    // Also try to broadcast to all extension views (side panel)
    broadcastToSidePanel(message);
  }

  if (message.type === "extractFromPage") {
    // Side panel is requesting extraction; forward to the active tab's content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "extract" }, (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({ error: "Could not reach content script. Make sure you are on a supported job page." });
          } else {
            sendResponse(response);
          }
        });
      } else {
        sendResponse({ error: "No active tab found." });
      }
    });
    // Return true to indicate async sendResponse
    return true;
  }
});

// Broadcast a message to all extension views (side panel, popup, etc.)
function broadcastToSidePanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // No listeners; side panel may not be open yet
  });
}
