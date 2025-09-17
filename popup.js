/* JavaScript */
document.getElementById("checkNowBtn").addEventListener("click", () => {
    console.log("[DEBUG_LOG] USER BUTTON CLICK INITIATED");

    // Send a simple message to the background script to start the process.
    // The background script will handle everything else.
    chrome.runtime.sendMessage({ type: "RUN_CHECK_NOW" }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Error sending message:", chrome.runtime.lastError);
            return;
        }
        console.log("[DEBUG_LOG] Message sent. Background response:", response);
    });

    // Close the popup immediately after sending the message.
    window.close();
});
