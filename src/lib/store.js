import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

const defaultData = {
  users: [],
  snapshots: [],
  events: [],
  followerCounts: []
};

function resolveFromRoot(value) {
  if (!value) return path.join(root, "data", "db.json");
  return path.isAbsolute(value) ? value : path.join(root, value);
}

export class Store {
  constructor(filePath = process.env.DATA_FILE) {
    this.filePath = resolveFromRoot(filePath);
    this.data = structuredClone(defaultData);
    this.load();
  }

  load() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this.save();
      return;
    }

    const raw = fs.readFileSync(this.filePath, "utf8");
    if (!raw.trim()) {
      this.save();
      return;
    }

    const parsed = JSON.parse(raw);
    this.data = {
      users: parsed.users ?? [],
      snapshots: parsed.snapshots ?? [],
      events: parsed.events ?? [],
      followerCounts: parsed.followerCounts ?? []
    };
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filePath);
  }

  list(collection) {
    return this.data[collection] ?? [];
  }

  insert(collection, record) {
    this.data[collection].push(record);
    this.save();
    return record;
  }

  update(collection, id, updater) {
    const item = this.data[collection].find((record) => record.id === id);
    if (!item) return null;
    const next = updater(item) ?? item;
    Object.assign(item, next);
    this.save();
    return item;
  }

  findUserByUsername(username) {
    return this.data.users.find((user) => user.instagramUsername === username);
  }

  findUserById(id) {
    return this.data.users.find((user) => user.id === id);
  }

  latestSnapshotForUser(userId) {
    return this.data.snapshots
      .filter((snapshot) => snapshot.userId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] ?? null;
  }

  snapshotsForUser(userId) {
    return this.data.snapshots
      .filter((snapshot) => snapshot.userId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  eventsForUser(userId) {
    return this.data.events
      .filter((event) => event.userId === userId)
      .sort((a, b) => new Date(b.detectedAt) - new Date(a.detectedAt));
  }

  followerCountsForUser(userId) {
    return this.data.followerCounts
      .filter((point) => point.userId === userId)
      .sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));
  }
}

export const store = new Store();
