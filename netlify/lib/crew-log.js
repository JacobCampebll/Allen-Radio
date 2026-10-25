// Shared crew-log storage: one Netlify Blobs record per message, keyed "<crew>/<epoch ms>-<id>",
// so the age of a record is readable from its key without downloading it.
// Messages are kept for 24 hours, then deleted.

import { getStore } from "@netlify/blobs";

export const CREWS = ["Beaver", "Powell", "Ian", "Blake"];
export const KEEP_MS = 24 * 60 * 60 * 1000;

export const logStore = () => getStore({ name: "crew-log", consistency: "strong" });

export const keyTime = (key) => Number(key.split("/")[1]?.split("-")[0]) || 0;

// Delete every record older than 24 hours for the given crews. Returns how many were removed.
export async function purgeExpired(crews = CREWS, store = logStore()) {
  const cutoff = Date.now() - KEEP_MS;
  let removed = 0;
  for (const crew of crews) {
    const { blobs } = await store.list({ prefix: `${crew}/` });
    const old = blobs.filter((b) => keyTime(b.key) < cutoff);
    for (let i = 0; i < old.length; i += 25) {
      await Promise.all(old.slice(i, i + 25).map((b) => store.delete(b.key)));
    }
    removed += old.length;
  }
  return removed;
}

// Delete every record for the given crews (the foreman's Erase button). Returns how many were removed.
export async function eraseAll(crews = CREWS, store = logStore()) {
  let removed = 0;
  for (const crew of crews) {
    const { blobs } = await store.list({ prefix: `${crew}/` });
    for (let i = 0; i < blobs.length; i += 25) {
      await Promise.all(blobs.slice(i, i + 25).map((b) => store.delete(b.key)));
    }
    removed += blobs.length;
  }
  return removed;
}
