import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { Store } from "../src/lib/store.js";
import { parseSnapshotFile, serializeParsed } from "../src/lib/parser.js";
import { createSnapshotFromParsed } from "../src/lib/analyzer.js";

function writeInstagramZip(filePath, followers, following) {
  const zip = new AdmZip();
  zip.addFile(
    "connections/followers_and_following/followers_1.json",
    Buffer.from(
      JSON.stringify(
        followers.map((username) => ({
          string_list_data: [{ value: username, href: `https://www.instagram.com/${username}/` }]
        }))
      )
    )
  );
  zip.addFile(
    "connections/followers_and_following/following.json",
    Buffer.from(
      JSON.stringify({
        relationships_following: following.map((username) => ({
          string_list_data: [{ value: username, href: `https://www.instagram.com/${username}/` }]
        }))
      })
    )
  );
  zip.writeZip(filePath);
}

test("snapshot comparison detects lost and gained followers", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "takip-panel-"));
  const store = new Store(path.join(dir, "db.json"));
  const user = store.insert("users", {
    id: "user-1",
    firstName: "Furkan",
    lastName: "TEST",
    instagramUsername: "furkan_123",
    previousUsernames: [],
    passwordHash: "x",
    externalAccountId: null,
    verifiedAt: null,
    createdAt: new Date().toISOString()
  });

  const firstZip = path.join(dir, "first.zip");
  writeInstagramZip(firstZip, ["alpha", "bravo"], ["alpha", "charlie"]);
  const firstParsed = serializeParsed(await parseSnapshotFile(firstZip, "first.zip"));
  const first = createSnapshotFromParsed(store, user, firstParsed, { originalName: "first.zip", size: 1 });

  assert.equal(first.analysis.counts.followers, 2);
  assert.deepEqual(first.analysis.notFollowingBack, ["charlie"]);
  assert.deepEqual(first.analysis.fansNotFollowed, ["bravo"]);

  const secondZip = path.join(dir, "second.zip");
  writeInstagramZip(secondZip, ["bravo", "delta"], ["bravo", "charlie"]);
  const secondParsed = serializeParsed(await parseSnapshotFile(secondZip, "second.zip"));
  const second = createSnapshotFromParsed(store, user, secondParsed, { originalName: "second.zip", size: 1 });

  assert.deepEqual(second.analysis.lost, ["alpha"]);
  assert.deepEqual(second.analysis.gained, ["delta"]);
  assert.equal(store.eventsForUser(user.id).filter((event) => event.type === "unfollowed").length, 1);
});
