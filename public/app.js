const state = {
  user: null,
  dashboard: null,
  view: "overview",
  authMode: "login",
  registerStep: 1,
  refreshTimer: null,
  liveRefreshTimer: null,
  lastUsernameCheck: null
};

const EXPORT_URL = "https://accountscenter.instagram.com/info_and_permissions/dyi/";

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

function formatMetric(value) {
  return typeof value === "number" ? value.toLocaleString("tr-TR") : "-";
}

function formatDelta(value) {
  if (typeof value !== "number") return "Önceki ölçüm yok";
  if (value === 0) return "Değişmedi";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toLocaleString("tr-TR")} son ölçüm`;
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

function updatePasswordRules(rootSelector, password) {
  const rules = passwordState(password);
  const root = $(rootSelector);
  for (const [key, ok] of Object.entries(rules)) {
    root.querySelector(`[data-rule="${key}"]`)?.classList.toggle("ok", ok);
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

function clearTimers() {
  clearInterval(state.refreshTimer);
  clearInterval(state.liveRefreshTimer);
  state.refreshTimer = null;
  state.liveRefreshTimer = null;
}

function showAuth() {
  $("#auth-screen").classList.remove("hidden");
  $("#app-screen").classList.add("hidden");
  clearTimers();
}

function showApp(payload) {
  state.user = payload.user;
  state.dashboard = payload.dashboard;
  $("#auth-screen").classList.add("hidden");
  $("#app-screen").classList.remove("hidden");
  renderDashboard();
  clearTimers();
  state.refreshTimer = setInterval(refreshDashboard, 2000);

  if (state.dashboard.capabilities?.metaMetricsEnabled) {
    refreshLiveMetrics({ silent: true });
    state.liveRefreshTimer = setInterval(() => refreshLiveMetrics({ silent: true }), 60000);
  }
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
    changes: "Değişenler",
    profile: "Profil"
  };
  $("#page-title").textContent = titles[view] || "Genel Özet";
  $$(".view").forEach((element) => element.classList.toggle("active", element.id === `${view}-view`));
  $$(".nav-item, .mobile-item, [data-view-link]").forEach((element) => {
    element.classList.toggle("active", (element.dataset.view || element.dataset.viewLink) === view);
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
  const { user, kpis, analysis, events, chart, deltas, capabilities } = state.dashboard;
  $("#user-name").textContent = `${user.firstName} ${user.lastName}`;
  $("#user-handle").textContent = user.displayUsername;
  $("#metric-followers").textContent = formatMetric(kpis.followers);
  $("#metric-following").textContent = formatMetric(kpis.following);
  $("#metric-media").textContent = formatMetric(kpis.mediaCount);
  $("#metric-lost").textContent = kpis.lostLastImport.toLocaleString("tr-TR");
  $("#metric-gained").textContent = kpis.gainedLastImport.toLocaleString("tr-TR");
  $("#delta-followers").textContent = formatDelta(deltas?.followers);
  $("#delta-following").textContent = formatDelta(deltas?.following);
  $("#delta-media").textContent = formatDelta(deltas?.media);
  $("#refresh-badge").textContent = `${capabilities?.uiRefreshSeconds ?? 2} sn`;
  $("#verify-status").textContent = user.verifiedAt ? "Doğrulandı" : "Bekliyor";
  $("#verify-status").className = `status-pill ${user.verifiedAt ? "teal" : "amber"}`;

  const lossEvents = events.filter((event) => event.type === "unfollowed");
  renderRows($("#loss-preview"), eventRows(lossEvents.slice(0, 5)), "Henüz takipten çıkan tespit edilmedi.");
  renderLossTable();
  renderChanges();
  renderRelationshipStats(analysis);
  renderProfileMetrics();
  renderProfileForm();
  drawChart(chart);
}

function renderProfileMetrics() {
  const metric = state.dashboard.profileMetric;
  const enabled = state.dashboard.capabilities?.metaMetricsEnabled;
  $("#profile-live-status").textContent = metric ? "Canlı" : enabled ? "Hazır" : "Bağlantı yok";
  $("#profile-live-status").className = `status-pill ${metric ? "teal" : "amber"}`;
  $("#profile-source-note").textContent = metric
    ? `Son kontrol: ${formatDate(metric.capturedAt)}`
    : enabled
      ? "Resmi Meta bağlantısı hazır. Metrikler otomatik izlenir."
      : "Canlı metrik için resmi Meta API bağlantısı gerekir; Instagram web sayfası arka planda kazınmaz.";

  const rows = [
    ["Takipçi", formatMetric(metric?.followersCount)],
    ["Takip edilen", formatMetric(metric?.followsCount)],
    ["Gönderi", formatMetric(metric?.mediaCount)],
    ["Kullanıcı adı", metric?.username ? `@${metric.username}` : state.dashboard.user.displayUsername],
    ["Profil adı", metric?.name || "-"],
    ["Kaynak", metric?.source || "-"]
  ];
  $("#profile-metric-list").innerHTML = rows
    .map(
      ([label, value]) => `
        <div class="stat-line">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(String(value))}</strong>
        </div>
      `
    )
    .join("");

  $("#profile-bio-box").innerHTML = `
    <span>Bio</span>
    <p>${escapeHtml(metric?.biography || "Canlı bio verisi yok.")}</p>
    <span>Web sitesi</span>
    <strong>${escapeHtml(metric?.website || "-")}</strong>
  `;
}

function renderLossTable() {
  const query = normalizeUsername($("#loss-search").value);
  const events = state.dashboard.events
    .filter((event) => event.type === "unfollowed")
    .filter((event) => !query || event.username.includes(query));
  renderRows($("#loss-table"), eventRows(events), "Liste boş.");
}

function renderChanges() {
  const usernameEvents = state.dashboard.events.filter((event) =>
    ["username_change", "account_username_changed"].includes(event.type)
  );
  const usernameRows = usernameEvents.map((event) => ({
    title:
      event.type === "account_username_changed"
        ? `@${event.previousUsername} -> @${event.username}`
        : `@${event.username}`,
    subtitle: event.type === "account_username_changed" ? "Panel hesabı/API ile güncellendi" : "Export içinde bulundu",
    meta: formatDate(event.changedAt || event.detectedAt)
  }));
  renderRows($("#username-change-list"), usernameRows, "Kullanıcı adı değişikliği bulunmadı.");

  const bioRows = state.dashboard.events
    .filter((event) => event.type === "biography_changed")
    .map((event) => ({
      title: `@${event.username}`,
      subtitle: `Eski: ${event.previousBiography || "-"} | Yeni: ${event.biography || "-"}`,
      meta: formatDate(event.detectedAt)
    }));
  renderRows($("#bio-change-list"), bioRows, "Bio değişimi bulunmadı.");

  const historyRows = (state.dashboard.profileHistory ?? []).map((metric) => ({
    title: `@${metric.username || state.dashboard.user.instagramUsername}`,
    subtitle: `Takipçi ${formatMetric(metric.followersCount)} | Takip edilen ${formatMetric(metric.followsCount)} | Gönderi ${formatMetric(metric.mediaCount)}`,
    meta: formatDate(metric.capturedAt)
  }));
  renderRows($("#live-history-list"), historyRows, "Canlı metrik geçmişi henüz yok.");
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

function renderProfileForm() {
  const user = state.dashboard.user;
  if (!user) return;
  if (!document.activeElement?.closest?.("#profile-form")) {
    $("#profile-first-name").value = user.firstName;
    $("#profile-last-name").value = user.lastName;
  }

  const previous = user.previousUsernames ?? [];
  const rows = previous.map((username) => ({
    title: `@${username}`,
    subtitle: "Bu eski kullanıcı adıyla da giriş yapabilirsin.",
    meta: "Eski ad"
  }));
  renderRows($("#previous-usernames"), rows, "Henüz eski kullanıcı adı yok.");
}

function drawChart(points = []) {
  const canvas = $("#followers-chart");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, Math.floor(rect.width)) * dpr;
  canvas.height = 280 * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const pad = 34;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#090910";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#2a2a36";
  ctx.lineWidth = 1;

  for (let i = 0; i < 4; i += 1) {
    const y = pad + ((height - pad * 2) / 3) * i;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
  }

  if (!points.length) {
    ctx.fillStyle = "#a7a7b5";
    ctx.font = "14px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("Canlı veri veya snapshot bekleniyor", width / 2, height / 2);
    return;
  }

  const values = points.map((point) => Number(point.count)).filter(Number.isFinite);
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
  const gradient = ctx.createLinearGradient(pad, 0, width - pad, 0);
  gradient.addColorStop(0, "#feda75");
  gradient.addColorStop(0.35, "#e1306c");
  gradient.addColorStop(0.7, "#833ab4");
  gradient.addColorStop(1, "#4f5bd5");

  ctx.strokeStyle = gradient;
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
    ctx.fillStyle = "#050509";
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#e1306c";
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  ctx.fillStyle = "#a7a7b5";
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

async function refreshLiveMetrics({ silent = false } = {}) {
  const button = $("#refresh-profile-btn");
  if (!state.user) return;
  if (!silent && button) {
    button.disabled = true;
    button.textContent = "Kontrol ediliyor...";
  }
  try {
    const payload = await api("/api/profile/refresh", { method: "POST" });
    state.dashboard = payload.dashboard;
    state.user = payload.dashboard.user;
    renderDashboard();
  } catch (error) {
    $("#profile-source-note").textContent = error.message;
    $("#profile-live-status").textContent = "Bağlantı yok";
    $("#profile-live-status").className = "status-pill amber";
  } finally {
    if (!silent && button) {
      button.disabled = false;
      button.textContent = "Canlı Metrikleri Yenile";
    }
  }
}

function handleAction(action) {
  if (action === "live-refresh") {
    refreshLiveMetrics();
    return;
  }
  if (action === "open-export") {
    window.open(EXPORT_URL, "_blank", "noopener,noreferrer");
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
  $("#register-password").addEventListener("input", (event) => {
    updatePasswordRules("#password-rules", event.target.value);
  });

  $("#profile-first-name").addEventListener("input", (event) => {
    event.target.value = titleNameLive(event.target.value);
  });
  $("#profile-first-name").addEventListener("blur", (event) => {
    event.target.value = titleName(event.target.value);
  });
  $("#profile-last-name").addEventListener("input", (event) => {
    event.target.value = upperLastNameLive(event.target.value);
  });
  $("#profile-last-name").addEventListener("blur", (event) => {
    event.target.value = upperLastName(event.target.value);
  });
  $("#new-password").addEventListener("input", (event) => {
    updatePasswordRules("#profile-password-rules", event.target.value);
  });

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
    if (!updatePasswordRules("#password-rules", $("#register-password").value)) {
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

  $$(".logout-action").forEach((button) => {
    button.addEventListener("click", async () => {
      await api("/api/auth/logout", { method: "POST" }).catch(() => {});
      state.user = null;
      state.dashboard = null;
      showAuth();
    });
  });

  $("#profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = $("#profile-message");
    message.textContent = "Güncelleniyor...";
    message.className = "message";
    try {
      const payload = await api("/api/account/profile", {
        method: "PATCH",
        body: JSON.stringify({
          firstName: $("#profile-first-name").value,
          lastName: $("#profile-last-name").value
        })
      });
      state.dashboard = payload.dashboard;
      state.user = payload.user;
      renderDashboard();
      message.textContent = "Profil güncellendi.";
      message.className = "message success";
    } catch (error) {
      message.textContent = error.message;
      message.className = "message error";
    }
  });

  $("#password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = $("#password-message");
    const newPassword = $("#new-password").value;
    if (!updatePasswordRules("#profile-password-rules", newPassword)) {
      message.textContent = "Yeni şifre kurallarını tamamlayın.";
      message.className = "message error";
      return;
    }
    message.textContent = "Şifre değiştiriliyor...";
    message.className = "message";
    try {
      await api("/api/account/password", {
        method: "PATCH",
        body: JSON.stringify({
          currentPassword: $("#current-password").value,
          newPassword
        })
      });
      event.currentTarget.reset();
      updatePasswordRules("#profile-password-rules", "");
      message.textContent = "Panel şifresi değiştirildi.";
      message.className = "message success";
    } catch (error) {
      message.textContent = error.message;
      message.className = "message error";
    }
  });

  $("#refresh-profile-btn").addEventListener("click", () => refreshLiveMetrics());

  $$(".nav-item, .mobile-item, [data-view-link]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view || button.dataset.viewLink));
  });
  $$("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAction(button.dataset.action));
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
