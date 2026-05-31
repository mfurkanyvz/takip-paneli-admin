import { v4 as uuidv4 } from "uuid";
import { normalizeInstagramUsername } from "./text.js";

function toSet(records = []) {
  return new Set(records.map((item) => normalizeInstagramUsername(item.username ?? item)).filter(Boolean));
}

function diff(left, right) {
  return [...left].filter((item) => !right.has(item)).sort((a, b) => a.localeCompare(b));
}

function topList(values, limit = 5000) {
  return values.slice(0, limit);
}

export function summarizeSnapshot(snapshot) {
  if (!snapshot) {
    return {
      counts: { followers: 0, following: 0, pendingRequests: 0 },
      lost: [],
      gained: [],
      notFollowingBack: [],
      fansNotFollowed: [],
      pendingRequests: [],
      usernameChanges: [],
      warnings: []
    };
  }

  return snapshot.analysis;
}

export async function createSnapshotFromParsed(store, user, parsed, uploadMeta = {}) {
  const now = new Date().toISOString();
  const accountUsername = parsed.account?.username ? normalizeInstagramUsername(parsed.account.username) : null;
  const accountId = parsed.account?.id ? String(parsed.account.id) : null;
  const previous = store.latestSnapshotForUser(user.id);

  let accountUsernameChanged = null;

  if (accountId && !user.externalAccountId) {
    await store.update("users", user.id, (current) => ({
      ...current,
      externalAccountId: accountId,
      verifiedAt: now
    }));
    user.externalAccountId = accountId;
    user.verifiedAt = now;
  }

  if (accountUsername && accountUsername !== user.instagramUsername) {
    const sameKnownAccount = accountId && user.externalAccountId && accountId === user.externalAccountId;
    if (!sameKnownAccount) {
      const error = new Error(`Bu dosya @${accountUsername} hesabına ait görünüyor. Panel hesabı @${user.instagramUsername}. Güvenlik için analiz durduruldu.`);
      error.status = 409;
      throw error;
    }

    const previousUsername = user.instagramUsername;
    await store.update("users", user.id, (current) => ({
      ...current,
      instagramUsername: accountUsername,
      previousUsernames: [...new Set([...(current.previousUsernames ?? []), previousUsername])],
      usernameChangedAt: now,
      verifiedAt: now
    }));
    user.instagramUsername = accountUsername;
    accountUsernameChanged = { previousUsername, currentUsername: accountUsername };
  } else if (accountUsername === user.instagramUsername && !user.verifiedAt) {
    await store.update("users", user.id, (current) => ({ ...current, verifiedAt: now }));
    user.verifiedAt = now;
  }

  const followers = toSet(parsed.followers);
  const following = toSet(parsed.following);
  const pendingRequests = toSet(parsed.pendingRequests);

  if (!followers.size && !following.size && !pendingRequests.size) {
    const error = new Error("Bu dosyada takipçi/takip edilen/istek listesi bulunamadı. Instagram export ZIP, JSON, HTML, CSV veya XLSX dosyası yüklemeyi deneyin.");
    error.status = 422;
    throw error;
  }

  const previousFollowers = previous ? new Set(previous.followers) : new Set();
  const lost = previous ? diff(previousFollowers, followers) : [];
  const gained = previous ? diff(followers, previousFollowers) : [];
  const notFollowingBack = diff(following, followers);
  const fansNotFollowed = diff(followers, following);

  const analysis = {
    counts: {
      followers: followers.size,
      following: following.size,
      pendingRequests: pendingRequests.size
    },
    lost: topList(lost),
    gained: topList(gained),
    notFollowingBack: topList(notFollowingBack),
    fansNotFollowed: topList(fansNotFollowed),
    pendingRequests: topList([...pendingRequests].sort((a, b) => a.localeCompare(b))),
    usernameChanges: parsed.usernameChanges ?? [],
    accountUsernameChanged,
    warnings: parsed.warnings ?? [],
    sourceSummary: parsed.sourceSummary ?? [],
    estimatedWindow: previous
      ? { from: previous.createdAt, to: now }
      : null
  };

  const snapshot = await store.insert("snapshots", {
    id: uuidv4(),
    userId: user.id,
    createdAt: now,
    originalName: uploadMeta.originalName,
    size: uploadMeta.size,
    account: parsed.account,
    followers: [...followers].sort((a, b) => a.localeCompare(b)),
    following: [...following].sort((a, b) => a.localeCompare(b)),
    pendingRequests: [...pendingRequests].sort((a, b) => a.localeCompare(b)),
    analysis
  });

  await store.insert("followerCounts", {
    id: uuidv4(),
    userId: user.id,
    capturedAt: now,
    count: followers.size,
    source: "snapshot"
  });

  for (const username of lost) {
    await store.insert("events", {
      id: uuidv4(),
      userId: user.id,
      type: "unfollowed",
      username,
      detectedAt: now,
      windowStart: previous?.createdAt ?? null,
      windowEnd: now,
      confidence: "snapshot"
    });
  }

  for (const username of gained) {
    await store.insert("events", {
      id: uuidv4(),
      userId: user.id,
      type: "new_follower",
      username,
      detectedAt: now,
      windowStart: previous?.createdAt ?? null,
      windowEnd: now,
      confidence: "snapshot"
    });
  }

  if (accountUsernameChanged) {
    await store.insert("events", {
      id: uuidv4(),
      userId: user.id,
      type: "account_username_changed",
      username: accountUsernameChanged.currentUsername,
      previousUsername: accountUsernameChanged.previousUsername,
      detectedAt: now,
      confidence: "account_id"
    });
  }

  for (const change of parsed.usernameChanges ?? []) {
    if (!change.username) continue;
    await store.insert("events", {
      id: uuidv4(),
      userId: user.id,
      type: "username_change",
      username: normalizeInstagramUsername(change.username),
      detectedAt: now,
      changedAt: change.changedAt ?? null,
      confidence: "export_metadata"
    });
  }

  return snapshot;
}
