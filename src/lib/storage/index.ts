"use client";

import type LocalForageType from "localforage";
import type { ImageEntry, ImageDataEntry } from "@/types";

const SESSION_KEY = "viewly_session_id";
const META_STORE = "viewly_meta";
const IMAGE_STORE = "viewly_images";

type LF = typeof LocalForageType;

let localforage: LF | null = null;
let metaStore: LF | null = null;
let imageStore: LF | null = null;
let _sessionId: string | null = null;

async function getLocalForage() {
  if (!localforage) {
    localforage = (await import("localforage")).default;
  }
  return localforage;
}

async function getStores() {
  const lf = await getLocalForage();

  if (!metaStore) {
    metaStore = lf.createInstance({ name: META_STORE, storeName: "meta" });
  }
  if (!imageStore) {
    imageStore = lf.createInstance({ name: IMAGE_STORE, storeName: "images" });
  }

  return { metaStore, imageStore };
}

function getSessionId(): string {
  if (_sessionId) return _sessionId;

  let sid = sessionStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    sessionStorage.setItem(SESSION_KEY, sid);
  }

  _sessionId = sid;
  return sid;
}

function metaKey(id: string) {
  return `${getSessionId()}:${id}`;
}

/** Save image metadata (small, fast) */
export async function saveImageMeta(entry: ImageEntry): Promise<void> {
  const { metaStore } = await getStores();
  await metaStore.setItem(metaKey(entry.id), entry);
}

/** Update specific fields on an image entry */
export async function updateImageMeta(
  id: string,
  updates: Partial<ImageEntry>
): Promise<ImageEntry | null> {
  const { metaStore } = await getStores();
  const key = metaKey(id);
  const existing = await metaStore.getItem<ImageEntry>(key);
  if (!existing) return null;

  const updated = { ...existing, ...updates };
  await metaStore.setItem(key, updated);
  return updated;
}

/** Load all image entries for this session, sorted by creation time */
export async function loadSessionEntries(): Promise<ImageEntry[]> {
  const { metaStore } = await getStores();
  const sessionId = getSessionId();
  const entries: ImageEntry[] = [];

  await metaStore.iterate<ImageEntry, void>((value, key) => {
    if (key.startsWith(`${sessionId}:`)) {
      entries.push(value);
    }
  });

  return entries.sort((a, b) => b.createdAt - a.createdAt);
}

/** Save image binary data (stored separately, large) */
export async function saveImageData(data: ImageDataEntry): Promise<void> {
  const { imageStore } = await getStores();
  await imageStore.setItem(metaKey(data.id), data);
}

/** Load image binary data */
export async function loadImageData(id: string): Promise<ImageDataEntry | null> {
  const { imageStore } = await getStores();
  return imageStore.getItem<ImageDataEntry>(metaKey(id));
}

/** Remove a single image entry and its data */
export async function removeImage(id: string): Promise<void> {
  const { metaStore, imageStore } = await getStores();
  const key = metaKey(id);
  await Promise.all([metaStore.removeItem(key), imageStore.removeItem(key)]);
}

/** Remove ALL data for this session */
export async function clearSession(): Promise<void> {
  const { metaStore, imageStore } = await getStores();
  const sessionId = getSessionId();
  const keysToDelete: string[] = [];

  await metaStore.iterate<ImageEntry, void>((_, key) => {
    if (key.startsWith(`${sessionId}:`)) keysToDelete.push(key);
  });

  await Promise.all(
    keysToDelete.flatMap((key) => [
      metaStore!.removeItem(key),
      imageStore!.removeItem(key),
    ])
  );
}

/**
 * Purge orphaned sessions from IndexedDB.
 * Called on app mount to clean up stale data from closed tabs.
 * Only the current session's data is kept.
 */
export async function purgeOrphanedSessions(): Promise<void> {
  const { metaStore, imageStore } = await getStores();
  const sessionId = getSessionId();
  const staleKeys: string[] = [];

  await metaStore.iterate<ImageEntry, void>((_, key) => {
    if (!key.startsWith(`${sessionId}:`)) {
      staleKeys.push(key);
    }
  });

  if (staleKeys.length > 0) {
    console.info(`[Storage] Purging ${staleKeys.length} orphaned entries from previous sessions`);
    await Promise.all(
      staleKeys.flatMap((key) => [
        metaStore!.removeItem(key),
        imageStore!.removeItem(key),
      ])
    );
  }
}


// ─── Audio Store ──────────────────────────────────────────────────────────────
// Stores TTS audio as base64-encoded WebM/Opus blobs in a separate IndexedDB
// store. Keyed the same way as images so purge logic covers them automatically.

const AUDIO_STORE = "viewly_audio";
let audioStore: LF | null = null;

async function getAudioStore() {
  const lf = await getLocalForage();
  if (!audioStore) {
    audioStore = lf.createInstance({ name: AUDIO_STORE, storeName: "audio" });
  }
  return audioStore;
}

export interface AudioEntry {
  id: string;         // same id as ImageEntry
  base64: string;     // base64-encoded audio blob
  mimeType: string;   // e.g. "audio/webm;codecs=opus"
  duration: number;   // seconds (approximate)
  createdAt: number;
}

/** Persist a recorded audio blob for an image entry */
export async function saveAudio(entry: AudioEntry): Promise<void> {
  const store = await getAudioStore();
  await store.setItem(metaKey(entry.id), entry);
}

/** Load audio for an image entry — null if not yet recorded */
export async function loadAudio(id: string): Promise<AudioEntry | null> {
  const store = await getAudioStore();
  return store.getItem<AudioEntry>(metaKey(id));
}

/** Delete audio for a single entry */
export async function removeAudio(id: string): Promise<void> {
  const store = await getAudioStore();
  await store.removeItem(metaKey(id));
}

/** Extend removeImage to also wipe audio */
export async function removeImageWithAudio(id: string): Promise<void> {
  const { metaStore, imageStore } = await getStores();
  const store = await getAudioStore();
  const key = metaKey(id);
  await Promise.all([
    metaStore.removeItem(key),
    imageStore.removeItem(key),
    store.removeItem(key),
  ]);
}

/** Extend clearSession to also wipe audio */
export async function clearSessionWithAudio(): Promise<void> {
  const { metaStore, imageStore } = await getStores();
  const audioSt = await getAudioStore();
  const sessionId = getSessionId();
  const keys: string[] = [];

  await metaStore.iterate<ImageEntry, void>((_, key) => {
    if (key.startsWith(`${sessionId}:`)) keys.push(key);
  });

  await Promise.all(
    keys.flatMap((key) => [
      metaStore.removeItem(key),
      imageStore.removeItem(key),
      audioSt.removeItem(key),
    ])
  );
}