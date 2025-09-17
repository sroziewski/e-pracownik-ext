/* JavaScript */
const usernameEl = document.getElementById("username");
const passwordEl = document.getElementById("password");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");

async function loadCredentials() {
    const { username, password } = await chrome.storage.local.get(["username", "password"]);
    if (username) usernameEl.value = username;
    if (password) passwordEl.value = password;
}

saveBtn.addEventListener("click", async () => {
    await chrome.storage.local.set({
        username: usernameEl.value.trim(),
        password: passwordEl.value
    });
    statusEl.textContent = "Credentials Saved.";
    setTimeout(() => (statusEl.textContent = ""), 1500);
});

loadCredentials();
