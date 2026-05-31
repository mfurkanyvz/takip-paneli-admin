import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

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
  constructor(filePath = process.env.DATA_FILE, databaseUrl = process.env.DATABASE_URL) {
    this.filePath = resolveFromRoot(filePath);
    this.databaseUrl = databaseUrl;
    this.pool = databaseUrl
      ? new pg.Pool({
          connectionString: databaseUrl,
          ssl: { rejectUnauthorized: false }
        })
      : null;
    this.data = structuredClone(defaultData);
    this.ready = this.load();
  }

  async load() {
    if (this.pool) {
      await this.pool.query(`
        create table if not exists app_state (
          key text primary key,
          value jsonb not null,
          updated_at timestamptz not null default now()
        )
      `);
      const result = await this.pool.query("select value from app_state where key = $1", ["default"]);
      if (result.rows[0]?.value) {
        const parsed = result.rows[0].value;
        this.data = {
          users: parsed.users ?? [],
          snapshots: parsed.snapshots ?? [],
          events: parsed.events ?? [],
          followerCounts: parsed.followerCounts ?? []
        };
      } else {
        await this.save();
      }
      return;
    }

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      await this.save();
      return;
    }

    const raw = fs.readFileSync(this.filePath, "utf8");
    if (!raw.trim()) {
      await this.save();
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

  async save() {
    if (this.pool) {
      await this.pool.query(
        `
          insert into app_state (key, value, updated_at)
          values ($1, $2, now())
          on conflict (key)
          do update set value = excluded.value, updated_at = now()
        `,
        ["default", this.data]
      );
      return;
    }

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filePath);
  }

  list(collection) {
    return this.data[collection] ?? [];
  }

  async insert(collection, record) {
    this.data[collection].push(record);
    await this.save();
    return record;
  }

  async update(collection, id, updater) {
    const item = this.data[collection].find((record) => record.id === id);
    if (!item) return null;
    const next = updater(item) ?? item;
    Object.assign(item, next);
    await this.save();
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
