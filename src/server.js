import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import connectPgSimple from "connect-pg-simple";
import express from "express";
import session from "express-session";
import helmet from "helmet";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { store } from "./lib/store.js";
import {
  formatFirstNames,
  formatLastName,
  isValidInstagramUsername,
  normalizeInstagramUsername,
  passwordIssues,
  toDisplayUsername
} from "./lib/text.js";
import { parseSnapshotFile, serializeParsed } from "./lib/parser.js";
import { createSnapshotFromParsed, summarizeSnapshot } from "./lib/analyzer.js";

await store.ready;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const uploadDir = path.resolve(root, process.env.UPLOAD_DIR ?? "uploads");
const uploadLimitMb = Number(process.env.UPLOAD_LIMIT_MB ?? 100);
const port = Number(process.env.PORT ?? 3000);

fs.mkdirSync(uploadDir, { recursive: true });

const app = express();
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: uploadLimitMb * 1024 * 1024
  }
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

const PgSession = connectPgSimple(session);
const sessionStore = store.pool
  ? new PgSession({
      pool: store.pool,
      tableName: "panel_sessions",
      createTableIfMissing: true
    })
  : undefined;

app.use(
  session({
    name: "takip_panel_sid",
    store: sessionStore,
    secret: process.env.SESSION_SECRET ?? "dev-secret-change-me",
    proxy: process.env.NODE_ENV === "production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 30
    }
  })
);

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    instagramUsername: user.instagramUsername,
    displayUsername: toDisplayUsername(user.instagramUsername),
    previousUsernames: user.previousUsernames ?? [],
    verifiedAt: user.verifiedAt ?? null,
    usernameChangedAt: user.usernameChangedAt ?? null,
    createdAt: user.createdAt
  };
}

function findUserForLogin(username) {
  const normalized = normalizeInstagramUsername(username);
  return store
    .list("users")
    .find((user) => user.instagramUsername === normalized || (user.previousUsernames ?? []).includes(normalized));
}

function requireAuth(req, res, next) {
  const user = store.findUserById(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "Oturum bulunamadı. Lütfen tekrar giriş yapın." });
  }
  req.user = user;
  return next();
}

function snapshotCard(snapshot) {
  const analysis = summarizeSnapshot(snapshot);
  return {
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    originalName: snapshot.originalName,
    counts: analysis.counts,
    lostCount: analysis.lost.length,
    gainedCount: analysis.gained.length,
    warningCount: analysis.warnings.length
  };
}

function dashboardFor(user) {
  const latest = store.latestSnapshotForUser(user.id);
  const profileMetric = store.latestProfileMetricForUser(user.id);
  const analysis = summarizeSnapshot(latest);
  const events = store.eventsForUser(user.id);
  const chart = store.followerCountsForUser(user.id);
  const snapshots = store.snapshotsForUser(user.id).map(snapshotCard);
  const unfollowEvents = events.filter((event) => event.type === "unfollowed");
  const latestUnfollow = unfollowEvents[0] ?? null;

  return {
    user: publicUser(user),
    latestSnapshot: latest ? snapshotCard(latest) : null,
    analysis,
    events: events.slice(0, 200),
    chart,
    snapshots,
    profileMetric,
    kpis: {
      followers: latest ? analysis.counts.followers : (profileMetric?.followersCount ?? null),
      following: latest ? analysis.counts.following : (profileMetric?.followsCount ?? null),
      mediaCount: profileMetric?.mediaCount ?? null,
      pendingRequests: analysis.counts.pendingRequests,
      lostLastImport: analysis.lost.length,
      gainedLastImport: analysis.gained.length,
      totalDetectedUnfollows: unfollowEvents.length,
      latestUnfollow
    },
    capabilities: {
      uiRefreshSeconds: 5,
      automaticFollowerList: false,
      publicProfileScraping: false,
      officialApiReady: true,
      metaMetricsEnabled: Boolean(process.env.META_ACCESS_TOKEN && process.env.META_IG_BUSINESS_ACCOUNT_ID),
      note: "Panel 5 saniyede bir yenilenir. İsim isim takipten çıkan analizi snapshot/export karşılaştırmasıyla çalışır."
    }
  };
}

async function fetchOfficialProfileMetrics(username) {
  const token = process.env.META_ACCESS_TOKEN;
  const businessAccountId = process.env.META_IG_BUSINESS_ACCOUNT_ID;
  if (!token || !businessAccountId) {
    const error = new Error("Canlı metrik için resmi Meta API bağlantısı gerekiyor.");
    error.status = 501;
    throw error;
  }

  const version = process.env.META_GRAPH_VERSION ?? "v23.0";
  const fields = `business_discovery.username(${username}){username,name,followers_count,follows_count,media_count,profile_picture_url}`;
  const url = new URL(`https://graph.facebook.com/${version}/${businessAccountId}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", token);

  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? "Meta API metrikleri alınamadı.");
    error.status = response.status;
    throw error;
  }

  return payload.business_discovery;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.post("/api/username/check", (req, res) => {
  const username = normalizeInstagramUsername(req.body.username);
  const formatValid = isValidInstagramUsername(username);
  const existsInPanel = Boolean(store.findUserByUsername(username));

  res.json({
    username,
    displayUsername: toDisplayUsername(username),
    formatValid,
    existsInPanel,
    realAccountVerified: false,
    message: formatValid
      ? "Format uygun. Gerçek hesap doğrulaması için Meta bağlantısı veya hesaba ait export dosyası gerekir."
      : "Kullanıcı adı formatı uygun değil."
  });
});

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const firstName = formatFirstNames(req.body.firstName);
    const lastName = formatLastName(req.body.lastName);
    const instagramUsername = normalizeInstagramUsername(req.body.instagramUsername);
    const password = String(req.body.password ?? "");

    if (!firstName || !lastName) {
      return res.status(400).json({ error: "Ad ve soyad zorunlu." });
    }
    if (!isValidInstagramUsername(instagramUsername)) {
      return res.status(400).json({ error: "Instagram kullanıcı adı formatı uygun değil." });
    }
    if (store.findUserByUsername(instagramUsername)) {
      return res.status(409).json({ error: "Bu Instagram kullanıcı adıyla panel hesabı zaten var." });
    }

    const issues = passwordIssues(password);
    if (issues.length) return res.status(400).json({ error: issues.join(" ") });

    const now = new Date().toISOString();
    const user = await store.insert("users", {
      id: uuidv4(),
      firstName,
      lastName,
      instagramUsername,
      previousUsernames: [],
      passwordHash: await bcrypt.hash(password, 12),
      externalAccountId: null,
      verifiedAt: null,
      createdAt: now,
      usernameChangedAt: null
    });

    req.session.userId = user.id;
    res.status(201).json({ user: publicUser(user), dashboard: dashboardFor(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const user = findUserForLogin(req.body.instagramUsername);
    const password = String(req.body.password ?? "");
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "Kullanıcı adı veya panel şifresi hatalı." });
    }
    req.session.userId = user.id;
    res.json({ user: publicUser(user), dashboard: dashboardFor(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("takip_panel_sid");
    res.json({ ok: true });
  });
});

app.get("/api/auth/me", (req, res) => {
  const user = store.findUserById(req.session.userId);
  if (!user) return res.json({ user: null });
  res.json({ user: publicUser(user), dashboard: dashboardFor(user) });
});

app.get("/api/dashboard", requireAuth, (req, res) => {
  res.json(dashboardFor(req.user));
});

app.post("/api/profile/refresh", requireAuth, async (req, res, next) => {
  try {
    const profile = await fetchOfficialProfileMetrics(req.user.instagramUsername);
    const now = new Date().toISOString();
    const metric = await store.insert("profileMetrics", {
      id: uuidv4(),
      userId: req.user.id,
      capturedAt: now,
      username: normalizeInstagramUsername(profile.username ?? req.user.instagramUsername),
      name: profile.name ?? null,
      followersCount: profile.followers_count ?? null,
      followsCount: profile.follows_count ?? null,
      mediaCount: profile.media_count ?? null,
      profilePictureUrl: profile.profile_picture_url ?? null,
      source: "meta_business_discovery"
    });

    if (typeof metric.followersCount === "number") {
      await store.insert("followerCounts", {
        id: uuidv4(),
        userId: req.user.id,
        capturedAt: now,
        count: metric.followersCount,
        source: "meta_business_discovery"
      });
    }

    res.json({ metric, dashboard: dashboardFor(req.user) });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/account/profile", requireAuth, async (req, res, next) => {
  try {
    const firstName = formatFirstNames(req.body.firstName);
    const lastName = formatLastName(req.body.lastName);
    const nextUsername = normalizeInstagramUsername(req.body.instagramUsername);

    if (!firstName || !lastName) return res.status(400).json({ error: "Ad ve soyad zorunlu." });
    if (!isValidInstagramUsername(nextUsername)) {
      return res.status(400).json({ error: "Instagram kullanıcı adı formatı uygun değil." });
    }

    const existing = store.findUserByUsername(nextUsername);
    if (existing && existing.id !== req.user.id) {
      return res.status(409).json({ error: "Bu Instagram kullanıcı adı başka bir panel hesabında kullanılıyor." });
    }

    const previousUsername = req.user.instagramUsername;
    const usernameChanged = previousUsername !== nextUsername;
    const updated = await store.update("users", req.user.id, (current) => ({
      ...current,
      firstName,
      lastName,
      instagramUsername: nextUsername,
      previousUsernames: usernameChanged
        ? [...new Set([...(current.previousUsernames ?? []), previousUsername])]
        : current.previousUsernames ?? [],
      usernameChangedAt: usernameChanged ? new Date().toISOString() : current.usernameChangedAt
    }));

    if (usernameChanged) {
      await store.insert("events", {
        id: uuidv4(),
        userId: req.user.id,
        type: "account_username_changed",
        username: nextUsername,
        previousUsername,
        detectedAt: new Date().toISOString(),
        confidence: "user_update"
      });
    }

    res.json({ user: publicUser(updated), dashboard: dashboardFor(updated) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/snapshots/upload", requireAuth, upload.single("snapshot"), async (req, res, next) => {
  let tempPath = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ error: "Dosya seçilmedi." });

    const parsed = await parseSnapshotFile(req.file.path, req.file.originalname);
    const snapshot = await createSnapshotFromParsed(store, req.user, serializeParsed(parsed), {
      originalName: req.file.originalname,
      size: req.file.size
    });

    res.status(201).json({
      snapshot: snapshotCard(snapshot),
      dashboard: dashboardFor(store.findUserById(req.user.id)),
      warnings: snapshot.analysis.warnings
    });
  } catch (error) {
    next(error);
  } finally {
    if (tempPath && fs.existsSync(tempPath)) {
      fs.rmSync(tempPath, { force: true });
    }
  }
});

app.get("/api/snapshots/:id", requireAuth, (req, res) => {
  const snapshot = store
    .snapshotsForUser(req.user.id)
    .find((item) => item.id === req.params.id);
  if (!snapshot) return res.status(404).json({ error: "Snapshot bulunamadı." });
  res.json(snapshot);
});

app.use(express.static(publicDir));
app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use((error, _req, res, _next) => {
  if (error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `Dosya çok büyük. Limit ${uploadLimitMb} MB.` });
  }
  const status = error.status || 500;
  res.status(status).json({
    error: status === 500 ? "Beklenmeyen bir hata oluştu." : error.message
  });
});

app.listen(port, () => {
  console.log(`Takip Paneli http://localhost:${port} adresinde çalışıyor.`);
});
