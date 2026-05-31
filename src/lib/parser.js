import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { isValidInstagramUsername, normalizeInstagramUsername, uniqueSortedUsernames } from "./text.js";

const USERNAME_FROM_URL = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9._]{1,30})(?:[/?#"]|$)/g;
const HANDLE = /@([a-zA-Z0-9._]{1,30})\b/g;

function emptyResult() {
  return {
    followers: new Map(),
    following: new Map(),
    pendingRequests: new Map(),
    account: {
      username: null,
      id: null,
      fullName: null
    },
    usernameChanges: [],
    sourceSummary: [],
    warnings: []
  };
}

function mergeResult(target, incoming) {
  for (const [key, value] of incoming.followers) target.followers.set(key, value);
  for (const [key, value] of incoming.following) target.following.set(key, value);
  for (const [key, value] of incoming.pendingRequests) target.pendingRequests.set(key, value);
  if (!target.account.username && incoming.account.username) target.account.username = incoming.account.username;
  if (!target.account.id && incoming.account.id) target.account.id = incoming.account.id;
  if (!target.account.fullName && incoming.account.fullName) target.account.fullName = incoming.account.fullName;
  target.usernameChanges.push(...incoming.usernameChanges);
  target.sourceSummary.push(...incoming.sourceSummary);
  target.warnings.push(...incoming.warnings);
  return target;
}

function inferCategory(sourceName = "", keyPath = "") {
  const sourceOnly = sourceName.toLowerCase().replaceAll("\\", "/");
  const value = `${sourceOnly}/${keyPath}`.toLowerCase();
  const fileName = sourceOnly.split("/").pop() ?? "";
  if (/^followers(?:_|\.|$)/.test(fileName) || /relationships_followers/.test(value)) {
    return "followers";
  }
  if (/^following(?:\.|_|$)/.test(fileName) || /relationships_following/.test(value)) {
    return "following";
  }
  if (/(pending|follow_requests|requests_you've_sent|follow request)/.test(value)) {
    return "pendingRequests";
  }
  if (/(followers|relationships_followers)/.test(value) && !/(following|follows)/.test(value)) {
    return "followers";
  }
  if (/(following|relationships_following|follows)/.test(value)) {
    return "following";
  }
  return null;
}

function addUsername(result, category, username, timestamp, source) {
  if (!category) return;
  const normalized = normalizeInstagramUsername(username);
  if (!isValidInstagramUsername(normalized)) return;
  result[category].set(normalized, {
    username: normalized,
    timestamp: timestamp ? new Date(timestamp * 1000).toISOString() : null,
    source
  });
}

function usernamesFromText(text) {
  const found = [];
  let match;
  USERNAME_FROM_URL.lastIndex = 0;
  while ((match = USERNAME_FROM_URL.exec(text))) found.push(match[1]);
  HANDLE.lastIndex = 0;
  while ((match = HANDLE.exec(text))) found.push(match[1]);

  for (const line of text.split(/\r?\n|,|;|\t/)) {
    const clean = normalizeInstagramUsername(line.replace(/^"|"$/g, ""));
    if (isValidInstagramUsername(clean)) found.push(clean);
  }

  return uniqueSortedUsernames(found);
}

function tryAccountDataFromStringMap(result, data, sourceName) {
  if (!data || typeof data !== "object") return;
  const map = data.string_map_data;
  if (!map || typeof map !== "object") return;

  const username = map.Username?.value ?? map.Kullanıcı?.value ?? map["Kullanıcı adı"]?.value;
  const name = map.Name?.value ?? map.Ad?.value ?? map["Ad Soyad"]?.value;
  const accountId = map["Instagram ID"]?.value ?? map["Account ID"]?.value ?? map["Hesap ID"]?.value;

  if (username && isValidInstagramUsername(username)) result.account.username = normalizeInstagramUsername(username);
  if (name && !result.account.fullName) result.account.fullName = String(name);
  if (accountId && !result.account.id) result.account.id = String(accountId);

  for (const [label, item] of Object.entries(map)) {
    if (/username|kullanıcı/i.test(label) && item?.timestamp && item?.value) {
      result.usernameChanges.push({
        username: normalizeInstagramUsername(item.value),
        changedAt: new Date(item.timestamp * 1000).toISOString(),
        source: sourceName
      });
    }
  }
}

function walkJson(result, value, sourceName, keyPath = "") {
  if (!value || typeof value !== "object") return;

  tryAccountDataFromStringMap(result, value, sourceName);

  if (Array.isArray(value.string_list_data)) {
    const category = inferCategory(sourceName, keyPath);
    for (const item of value.string_list_data) {
      const candidate = item?.value || item?.href || "";
      const fromHref = usernamesFromText(String(item?.href ?? ""));
      const names = usernamesFromText(String(candidate));
      for (const username of [...names, ...fromHref]) {
        addUsername(result, category, username, item?.timestamp, sourceName);
      }
    }
  }

  for (const [key, child] of Object.entries(value)) {
    const nextPath = keyPath ? `${keyPath}.${key}` : key;

    if (typeof child === "string") {
      const lowerPath = `${sourceName}/${nextPath}`.toLowerCase();
      if (/account|profile|personal/.test(lowerPath) && /(^|\.)(username|kullanıcı adı|kullanici adi)$/i.test(nextPath)) {
        const candidate = normalizeInstagramUsername(child);
        if (isValidInstagramUsername(candidate)) result.account.username = candidate;
      }
      if (/account|profile|personal/.test(lowerPath) && /(^|\.)(id|account id|instagram id|hesap id)$/i.test(nextPath)) {
        result.account.id = child;
      }
    }

    if (child && typeof child === "object") {
      walkJson(result, child, sourceName, nextPath);
    }
  }
}

function parseJsonBuffer(buffer, sourceName) {
  const result = emptyResult();
  try {
    const parsed = JSON.parse(buffer.toString("utf8"));
    walkJson(result, parsed, sourceName);
    result.sourceSummary.push({ file: sourceName, type: "json", ok: true });
  } catch (error) {
    result.warnings.push(`${sourceName}: JSON okunamadı (${error.message}).`);
    result.sourceSummary.push({ file: sourceName, type: "json", ok: false });
  }
  return result;
}

function parseTextBuffer(buffer, sourceName, type = "text") {
  const result = emptyResult();
  const text = buffer.toString("utf8");
  const category = inferCategory(sourceName);
  if (category) {
    for (const username of usernamesFromText(text)) addUsername(result, category, username, null, sourceName);
  }
  result.sourceSummary.push({ file: sourceName, type, ok: true });
  return result;
}

function decodeXml(value = "") {
  return String(value)
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function textFromXmlTags(xml, tagName) {
  const values = [];
  const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "g");
  let match;
  while ((match = pattern.exec(xml))) {
    values.push(decodeXml(match[1].replace(/<[^>]+>/g, "")));
  }
  return values;
}

function parseWorkbookBuffer(buffer, sourceName) {
  const result = emptyResult();
  try {
    const zip = new AdmZip(buffer);
    const sharedEntry = zip.getEntry("xl/sharedStrings.xml");
    const sharedStrings = sharedEntry
      ? textFromXmlTags(sharedEntry.getData().toString("utf8"), "si").map((item) => item.trim())
      : [];
    const worksheetEntries = zip
      .getEntries()
      .filter((entry) => /^xl\/worksheets\/.+\.xml$/i.test(entry.entryName));

    for (const entry of worksheetEntries) {
      const xml = entry.getData().toString("utf8");
      const values = [];
      let cellMatch;
      const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
      while ((cellMatch = cellPattern.exec(xml))) {
        const attrs = cellMatch[1];
        const body = cellMatch[2];
        const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        const inline = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(body)?.[1];
        if (/\bt="s"/.test(attrs) && value != null) {
          values.push(sharedStrings[Number(value)] ?? "");
        } else if (inline != null) {
          values.push(decodeXml(inline));
        } else if (value != null) {
          values.push(decodeXml(value));
        }
      }
      const text = values.filter(Boolean).join("\n");
      mergeResult(result, parseTextBuffer(Buffer.from(text, "utf8"), `${sourceName}/${entry.entryName}`, "xlsx"));
    }

    if (!worksheetEntries.length) {
      result.warnings.push(`${sourceName}: Excel dosyasında sayfa bulunamadı.`);
    }
    result.sourceSummary.push({ file: sourceName, type: "xlsx", ok: true });
  } catch (error) {
    result.warnings.push(`${sourceName}: Excel dosyası okunamadı (${error.message}).`);
    result.sourceSummary.push({ file: sourceName, type: "xlsx", ok: false });
  }
  return result;
}

async function parseByExtension(buffer, sourceName) {
  const ext = path.extname(sourceName).toLowerCase();
  if (ext === ".json") return parseJsonBuffer(buffer, sourceName);
  if ([".html", ".htm", ".csv", ".txt", ".tsv"].includes(ext)) {
    return parseTextBuffer(buffer, sourceName, ext.slice(1));
  }
  if (ext === ".xlsx") return parseWorkbookBuffer(buffer, sourceName);

  const result = emptyResult();
  result.warnings.push(`${sourceName}: Bu dosya tipi analiz için desteklenmiyor. ZIP, JSON, HTML, CSV, TXT ve XLSX önerilir.`);
  result.sourceSummary.push({ file: sourceName, type: ext || "unknown", ok: false });
  return result;
}

async function parseZip(filePath) {
  const result = emptyResult();
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  for (const entry of entries) {
    const name = entry.entryName;
    const ext = path.extname(name).toLowerCase();
    if (![".json", ".html", ".htm", ".csv", ".txt", ".tsv", ".xlsx"].includes(ext)) continue;
    const child = await parseByExtension(entry.getData(), name);
    mergeResult(result, child);
  }
  result.sourceSummary.push({ file: path.basename(filePath), type: "zip", ok: true, filesRead: entries.length });
  return result;
}

export async function parseSnapshotFile(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === ".zip") return parseZip(filePath);
  return parseByExtension(fs.readFileSync(filePath), originalName);
}

export function serializeParsed(parsed) {
  return {
    followers: [...parsed.followers.values()],
    following: [...parsed.following.values()],
    pendingRequests: [...parsed.pendingRequests.values()],
    account: parsed.account,
    usernameChanges: parsed.usernameChanges,
    sourceSummary: parsed.sourceSummary,
    warnings: parsed.warnings
  };
}
