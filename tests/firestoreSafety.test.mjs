import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : ['.ts', '.svelte', '.mjs'].includes(extname(path)) ? [path] : [];
  });
}

test('Firestore rules never grant anonymous global access', () => {
  assert.doesNotMatch(rules, /allow\s+(?:read|write|read,\s*write)\s*:\s*if\s+true/);
  assert.match(rules, /match \/\{document=\*\*\}[\s\S]*allow read, write: if false;/);
});

test('all user data collections remain owner-scoped', () => {
  assert.match(rules, /match \/users\/\{userId\}/);
  const lines = rules.split('\n');
  for (const collection of ['items', 'imageBackups', 'outfits', 'logs', 'meta', 'studyLogs', 'surgeryTracker', 'surgerySessions', 'lifeHabits', 'lifeTasks', 'lifeBooks', 'lifeEntries']) {
    const start = lines.findIndex((line) => line.includes(`match /${collection}/{`));
    assert.notEqual(start, -1, `${collection} must remain under the user rule`);
    const collectionRule = lines.slice(start, start + 6).join('\n');
    assert.match(
      collectionRule,
      /request\.auth != null && request\.auth\.uid == userId/,
      `${collection} access must require the authenticated owner`
    );
  }
});

test('Life tracker records are owner-only and cannot be hard-deleted', () => {
  const lines = rules.split('\n');
  for (const collection of ['lifeHabits', 'lifeTasks', 'lifeBooks', 'lifeEntries']) {
    const start = lines.findIndex((line) => line.includes(`match /${collection}/{`));
    const collectionRule = lines.slice(start, start + 6).join('\n');
    assert.match(collectionRule, /allow create, read, update: if request\.auth != null && request\.auth\.uid == userId/);
    assert.match(collectionRule, /allow delete: if false/);
  }
});

test('Life page only uses authenticated user subcollections and never hard-deletes records', () => {
  const life = readFileSync(new URL('../src/routes/(app)/life/+page.svelte', import.meta.url), 'utf8');
  assert.match(life, /collection\(db, 'users', uid, name\)/);
  assert.doesNotMatch(life, /\bdeleteDoc\b/);
  assert.doesNotMatch(life, /collection\(db, ['"](?:lifeHabits|lifeTasks|lifeBooks|lifeEntries)['"]\)/);
  assert.match(life, /active: false, completed: false/);
  assert.match(life, /batch\.set\(entryRef, entryPayload\)[\s\S]*batch\.update\(doc\(db, 'users', uid, 'lifeBooks', book\.id\), bookPatch\)/);
});

test('automatic image backups are owner-only and immutable', () => {
  const lines = rules.split('\n');
  const start = lines.findIndex((line) => line.includes('match /imageBackups/{itemId}'));
  const backupRule = lines.slice(start, start + 7).join('\n');
  assert.match(backupRule, /allow create, read: if request\.auth != null && request\.auth\.uid == userId/);
  assert.match(backupRule, /allow update, delete: if false/);
});

test('legacy root-level item access is isolated to the non-destructive migration helper', () => {
  const files = sourceFiles(fileURLToPath(new URL('../src/', import.meta.url)));
  const unsafe = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (/\b(?:collection|doc)\(db,\s*['"]items['"]/.test(source)) unsafe.push(file);
  }
  assert.deepEqual(unsafe, [fileURLToPath(new URL('../src/lib/migrate.ts', import.meta.url))]);
  const migration = readFileSync(unsafe[0], 'utf8');
  assert.doesNotMatch(migration, /\b(?:deleteDoc|deleteField|writeBatch)\b/);
});

test('tests cannot accidentally import the live Firebase clients', () => {
  const files = sourceFiles(fileURLToPath(new URL('.', import.meta.url)));
  const unsafe = files.filter((file) => /from\s+['"].*(?:firebase|firebase-admin)/.test(readFileSync(file, 'utf8')));
  assert.deepEqual(unsafe, []);
});

test('visual outfit studio only creates outfits and updates its isolated owner-only learning profile', () => {
  const studio = readFileSync(
    new URL('../src/routes/(app)/outfit-studio/+page.svelte', import.meta.url),
    'utf8'
  );
  assert.match(studio, /addDoc\(collection\(db, 'users', userId, 'outfits'\)/);
  assert.match(studio, /setDoc\(doc\(db, 'users', userId, 'meta', 'outfitIntelligence'\)/);
  assert.equal(studio.match(/\bsetDoc\s*\(/g)?.length, 1);
  assert.doesNotMatch(studio, /\b(?:updateDoc|deleteDoc|writeBatch|runTransaction)\b/);
  assert.doesNotMatch(studio, /addDoc\(collection\(db, 'users', userId, 'items'\)/);
  assert.doesNotMatch(studio, /setDoc\(doc\(db, 'users', userId, 'items'/);
});

test('outfit archive permission failures cannot block the read-only wardrobe studio', () => {
  const studio = readFileSync(
    new URL('../src/routes/(app)/outfit-studio/+page.svelte', import.meta.url),
    'utf8'
  );
  const wardrobeRead = studio.indexOf("getDocs(collection(db, 'users', userId, 'items'))");
  const archiveRead = studio.indexOf("getDocs(collection(db, 'users', userId, 'outfits'))");
  assert.ok(wardrobeRead > -1 && archiveRead > wardrobeRead);
  assert.match(studio, /catch \(archiveError\)[\s\S]*outfitArchiveAvailable = false;/);
});
