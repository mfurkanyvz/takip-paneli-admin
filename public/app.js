const state = {
  user: null,
  dashboard: null,
  view: "overview",
  authMode: "login",
  registerStep: 1,
  refreshTimer: null,
  lastUsernameCheck: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function normalizeUsername(value = "") {
  return String(value).trim().replace(/^@+/, "").toLowerCase();
}

function titleName(value = "") {
  return String(value)
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLocaleLowerCase("tr-TR");
      return `${lower.charAt(0).toLocaleUpperCase("tr-TR")}${lower.slice(1)}`;
    })
    .join(" ");
}

function upperLastName(value = "") {
  return String(value).trim().replace(/\s+/g, " ").toLocaleUpperCase("tr-TR");
}

function preserveTrailingSpace(original, formatted) {
  return /\s$/.test(original) && formatted ? `${formatted} ` : formatted;
}

function titleNameLive(value = "") {
  return preserveTrailingSpace(value, titleName(value));
}

function upperLastNameLive(value = "") {
  return preserveTrailingSpace(value, upperLastName(value));
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...options
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "İşlem başarısız.");
  return data;
}

function setMessage(message = "", type = "") {
  const element = $("#auth-message");
  element.textContent = message;
  element.className = `message ${type}`;
}

function setAuthMode(mode) {
  state.authMode = mode;
  $("#login-tab").classList.toggle("active", mode === "login");
  $("#register-tab").classList.toggle("active", mode === "register");
  $("#login-form").classList.toggle("hidden", mode !== "login");
  $("#register-form").classList.toggle("hidden", mode !== "register");
  $("#auth-subtitle").textContent = mode === "login" ? "Giriş yap" : "Kayıt ol";
  setMessage();
}

function setRegisterStep(step) {
  state.registerStep = step;
  $$("[data-step]").forEach((element) => {
    element.classList.toggle("hidden", Number(element.dataset.step) !== step);
  });
  $$("[data-step-dot]").forEach((element) => {
    element.classList.toggle("active", Number(element.dataset.stepDot) <= step);
  });
}

function passwordState(password) {
  return {
    length: password.length >= 5,
    upper: /[A-ZÇĞİÖŞÜ]/.test(password),
    lower: /[a-zçğıöşü]/.test(password),
    number: /\d/.test(password),
    symbol: /[^A-Za-zÇĞİÖŞÜçğıöşü0-9]/.test(password)
  };
}

function updatePasswordRules() {
  const rules = passwordState($("#register-password").value);
  for (const [key, ok] of Object.entries(rules)) {
    $(`[data-rule="${key}"]`).classList.toggle("ok", ok);
  }
  return Object.values(rules).every(Boolean);
}

async function checkUsername() {
  const username = normalizeUsername($("#register-username").value);
  const status = $("#username-check");
  if (!username) {
    status.textContent = "Kullanıcı adı bekleniyor.";
    status.className = "form-status muted";
    return false;
  }

  try {
    const result = await api("/api/username/check", {
      method: "POST",
      body: JSON.stringify({ username })
    });
    state.lastUsernameCheck = result;
    status.textContent = result.existsInPanel
      ? "Bu kullanıcı adıyla panel hesabı zaten var."
      : result.message;
    status.className = `form-status ${result.formatValid && !result.existsInPanel ? "success" : "error"}`;
    return result.formatValid && !result.existsInPanel;
  } catch (error) {
    status.textContent = error.message;
    status.className = "form-status error";
    return false;
  }
}

function showAuth() {
  $("#auth-screen").classList.remove("hidden");
  $("#app-screen").classList.add("hidden");
  clearInterval(state.refreshTimer);
}

function showApp(payload) {
  state.user = payload.user;
  state.dashboard = payload.dashboard;
  $("#auth-screen").classList.add("hidden");
  $("#app-screen").classList.remove("hidden");
  renderDashboard();
  clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(refreshDashboard, 5000);
}

async function refreshDashboard() {
  if (!state.user) return;
  try {
    state.dashboard = await api("/api/dashboard");
    state.user = state.dashboard.user;
    renderDashboard();
  } catch (error) {
    if (/Oturum/.test(error.message)) showAuth();
  }
}

function setView(view) {
  state.view = view;
  const titles = {
    overview: "Genel Özet",
    losses: "Takipten Çıkanlar",
    upload: "Snapshot Yükle",
    changes: "Değişenler"
  };
  $("#page-title").textContent = titles[view] || "Genel Özet";
  $$(".view").forEach((element) => element.classList.toggle("active", element.id === `${view}-view`));
  $$(".nav-item, .mobile-item").forEach((element) => {
    element.classList.toggle("active", element.dataset.view === view);
  });
}

function renderRows(container, rows, emptyText) {
  if (!rows.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
    return;
  }

  container.innerHTML = rows
    .map(
      (row) => `
        <div class="row-item">
          <div>
            <strong>${escapeHtml(row.title)}</strong>
            <span>${escapeHtml(row.subtitle || "")}</span>
          </div>
          <span>${escapeHtml(row.meta || "")}</span>
        </div>
      `
    )
    .join("");
}

function eventRows(events) {
  return events.map((event) => {
    const windowText = event.windowStart
      ? `${formatDate(event.windowStart)} - ${formatDate(event.windowEnd)}`
      : "İlk snapshot sonrası";
    return {
      title: `@${event.username}`,
      subtitle: `Aralık: ${windowText}`,
      meta: `Tespit: ${formatDate(event.detectedAt)}`
    };
  });
}

function renderDashboard() {
  if (!state.dashboard) return;
  const { user, kpis, analysis, events, chart } = state.dashboard;
  $("#user-name").textContent = `${user.firstName} ${user.lastName}`;
  $("#user-handle").textContent = user.displayUsername;
  $("#metric-followers").textContent = kpis.followers.toLocaleString("tr-TR");
  $("#metric-following").textContent = kpis.following.toLocaleString("tr-TR");
  $("#metric-lost").textContent = kpis.lostLastImport.toLocaleString("tr-TR");
  $("#metric-gained").textContent = kpis.gainedLastImport.toLocaleString("tr-TR");
  $("#verify-status").textContent = user.verifiedAt ? "Doğrulandı" : "Bekliyor";
  $("#verify-status").className = `status-pill ${user.verifiedAt ? "teal" : "amber"}`;

  const lossEvents = events.filter((event) => event.type === "unfollowed");
  renderRows($("#loss-preview"), eventRows(lossEvents.slice(0, 5)), "Henüz takipten çıkan tespit edilmedi.");
  renderLossTable();
  renderChanges();
  renderRelationshipStats(analysis);
  drawChart(chart);
}

function renderLossTable() {
  const query = normalizeUsername($("#loss-search").value);
  const events = state.dashboard.events
    .filter((event) => event.type === "unfollowed")
    .filter((event) => !query || event.username.includes(query));
  renderRows($("#loss-table"), eventRows(events), "Liste boş.");
}

function renderChanges() {
  const events = state.dashboard.events.filter((event) =>
    ["username_change", "account_username_changed"].includes(event.type)
  );
  const rows = events.map((event) => ({
    title:
      event.type === "account_username_changed"
        ? `@${event.previousUsername} → @${event.username}`
        : `@${event.username}`,
    subtitle: event.type === "account_username_changed" ? "Panel hesabı güncellendi" : "Export içinde bulundu",
    meta: formatDate(event.changedAt || event.detectedAt)
  }));
  renderRows($("#username-change-list"), rows, "Kullanıcı adı değişikliği bulunmadı.");
}

function renderRelationshipStats(analysis) {
  const items = [
    ["Beni takip ediyor, ben etmiyorum", analysis.fansNotFollowed.length],
    ["Ben takip ediyorum, o etmiyor", analysis.notFollowingBack.length],
    ["Bekleyen istek", analysis.pendingRequests.length],
    ["Uyarı", analysis.warnings.length]
  ];
  $("#relationship-list").innerHTML = items
    .map(
      ([label, value]) => `
        <div class="stat-line">
          <span>${escapeHtml(label)}</span>
          <strong>${Number(value).toLocaleString("tr-TR")}</strong>
        </div>
      `
    )
    .join("");
}

function drawChart(points = []) {
  const canvas = $("#followers-chart");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, rect.width) * dpr;
  canvas.height = 280 * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const pad = 34;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0b111a";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#263241";
  ctx.lineWidth = 1;

  for (let i = 0; i < 4; i += 1) {
    const y = pad + ((height - pad * 2) / 3) * i;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
  }

  if (!points.length) {
    ctx.fillStyle = "#9ca8b8";
    ctx.font = "14px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("Snapshot bekleniyor", width / 2, height / 2);
    return;
  }

  const values = points.map((point) => Number(point.count));
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }

  const xFor = (index) => {
    if (points.length === 1) return width / 2;
    return pad + ((width - pad * 2) / (points.length - 1)) * index;
  };
  const yFor = (value) => height - pad - ((value - min) / (max - min)) * (height - pad * 2);

  ctx.strokeStyle = "#22d3ee";
  ctx.lineWidth = 3;
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = xFor(index);
    const y = yFor(Number(point.count));
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  points.forEach((point, index) => {
    const x = xFor(index);
    const y = yFor(Number(point.count));
    ctx.fillStyle = "#07090d";
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#22d3ee";
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  ctx.fillStyle = "#9ca8b8";
  ctx.font = "12px system-ui";
  ctx.textAlign = "left";
  ctx.fillText(max.toLocaleString("tr-TR"), 10, pad + 4);
  ctx.fillText(min.toLocaleString("tr-TR"), 10, height - pad + 4);
}

async function uploadSnapshot(form, resultElement) {
  const file = form.querySelector('input[type="file"]').files[0];
  if (!file) {
    resultElement.innerHTML = `<p class="message error">Dosya seçilmedi.</p>`;
    return;
  }

  const body = new FormData();
  body.append("snapshot", file);
  resultElement.innerHTML = `<p class="message">Yükleniyor...</p>`;

  try {
    const result = await api("/api/snapshots/upload", { method: "POST", body });
    state.dashboard = result.dashboard;
    state.user = result.dashboard.user;
    renderDashboard();
    resultElement.innerHTML = `<p class="message success">Snapshot işlendi. Takipçi: ${result.snapshot.counts.followers.toLocaleString("tr-TR")}</p>`;
    form.reset();
  } catch (error) {
    resultElement.innerHTML = `<p class="message error">${escapeHtml(error.message)}</p>`;
  }
}

function bindEvents() {
  $("#login-tab").addEventListener("click", () => setAuthMode("login"));
  $("#register-tab").addEventListener("click", () => setAuthMode("register"));

  $("#first-name").addEventListener("input", (event) => {
    event.target.value = titleNameLive(event.target.value);
  });
  $("#first-name").addEventListener("blur", (event) => {
    event.target.value = titleName(event.target.value);
  });
  $("#last-name").addEventListener("input", (event) => {
    event.target.value = upperLastNameLive(event.target.value);
  });
  $("#last-name").addEventListener("blur", (event) => {
    event.target.value = upperLastName(event.target.value);
  });
  $("#register-username").addEventListener("input", (event) => {
    event.target.value = normalizeUsername(event.target.value);
    $("#username-check").textContent = "Kullanıcı adı bekleniyor.";
    $("#username-check").className = "form-status muted";
  });
  $("#register-username").addEventListener("blur", checkUsername);
  $("#register-password").addEventListener("input", updatePasswordRules);

  $$("[data-next-step]").forEach((button) => {
    button.addEventListener("click", async () => {
      const next = Number(button.dataset.nextStep);
      if (next === 2 && (!$("#first-name").value.trim() || !$("#last-name").value.trim())) {
        setMessage("Ad ve soyad zorunlu.", "error");
        return;
      }
      if (next === 3 && !(await checkUsername())) return;
      setMessage();
      setRegisterStep(next);
    });
  });
  $$("[data-prev-step]").forEach((button) => {
    button.addEventListener("click", () => setRegisterStep(Number(button.dataset.prevStep)));
  });

  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage();
    try {
      const payload = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          instagramUsername: $("#login-username").value,
          password: $("#login-password").value
        })
      });
      showApp(payload);
    } catch (error) {
      setMessage(error.message, "error");
    }
  });

  $("#register-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!updatePasswordRules()) {
      setMessage("Şifre kurallarını tamamlayın.", "error");
      return;
    }
    try {
      const payload = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          firstName: $("#first-name").value,
          lastName: $("#last-name").value,
          instagramUsername: $("#register-username").value,
          password: $("#register-password").value
        })
      });
      showApp(payload);
    } catch (error) {
      setMessage(error.message, "error");
    }
  });

  $("#logout-btn").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    state.user = null;
    state.dashboard = null;
    showAuth();
  });

  $$(".nav-item, .mobile-item, [data-view-link]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view || button.dataset.viewLink));
  });

  $("#loss-search").addEventListener("input", renderLossTable);
  $("#quick-upload-form").addEventListener("submit", (event) => {
    event.preventDefault();
    uploadSnapshot(event.currentTarget, $("#upload-hint"));
  });
  $("#upload-form").addEventListener("submit", (event) => {
    event.preventDefault();
    uploadSnapshot(event.currentTarget, $("#upload-result"));
  });
  window.addEventListener("resize", () => drawChart(state.dashboard?.chart ?? []));
}

async function init() {
  bindEvents();
  setAuthMode("login");
  setRegisterStep(1);
  try {
    const payload = await api("/api/auth/me");
    if (payload.user) showApp(payload);
    else showAuth();
  } catch (_error) {
    showAuth();
  }
}

init();
