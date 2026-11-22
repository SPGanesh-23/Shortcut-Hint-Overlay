// Welcome page (opened once on first install).
document.getElementById("options-btn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
document.getElementById("close-btn").addEventListener("click", () => {
  window.close();
});
