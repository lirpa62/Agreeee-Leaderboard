document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("error");
  errorEl.textContent = "";
  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: document.getElementById("password").value,
      }),
    });
    const json = await res.json();
    if (json.ok) {
      location.href = "/admin/";
    } else {
      errorEl.textContent = json.error || "로그인에 실패했습니다.";
    }
  } catch {
    errorEl.textContent = "서버에 연결할 수 없습니다.";
  }
});
