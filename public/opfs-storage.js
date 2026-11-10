/**
 * OPFS (Origin Private File System) を使った楽曲データの保存・一覧・読込・削除モジュール。
 *
 * ディレクトリ構成:
 * [OPFS Root]
 * └── songs/
 *     ├── index.json             ... サマリ一覧 (高速化用キャッシュ)
 *     ├── song_17000000_abc.json ... 1曲ごとの完全データ (score, midi, sections, request)
 *     └── ...
 */

/** ブラウザが OPFS に対応しているか判定 */
export function isOpfsSupported() {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage !== "undefined" &&
    typeof navigator.storage.getDirectory === "function"
  );
}

/** OPFS の songs ディレクトリハンドルを取得 */
export async function getSongsDirectory(customRoot = null) {
  const root = customRoot || (await navigator.storage.getDirectory());
  return await root.getDirectoryHandle("songs", { create: true });
}

/** ファイルへの書き込みヘルパー */
async function writeTextFile(dirHandle, fileName, text) {
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  if (typeof fileHandle.createWritable === "function") {
    const writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
  } else {
    throw new Error("FileSystemFileHandle.createWritable is not supported in this environment");
  }
}

/** ファイルの読み込みヘルパー */
async function readTextFile(dirHandle, fileName) {
  const fileHandle = await dirHandle.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  return await file.text();
}

/** 楽曲データからサマリ行を作成 */
function makeSummary(song) {
  return {
    id: song.id,
    title: song.title || song.score?.title || "Untitled",
    createdAt: song.createdAt || new Date().toISOString(),
    bpm: song.score?.bpm ?? 120,
    key: song.score?.key ?? "C major",
    bars: song.request?.bars ?? 8,
    loop: song.request?.loop ?? false,
    ensemble: song.request?.ensemble ?? "band",
    prompt: song.request?.prompt ?? "",
    noteCount: song.score?.tracks
      ? song.score.tracks.reduce((acc, t) => acc + (t.notes ? t.notes.length : 0), 0)
      : 0,
  };
}

/** index.json を再構築して保存 */
async function rebuildIndex(dirHandle) {
  const list = [];
  // @ts-ignore entries iteration
  for await (const [name, handle] of dirHandle.entries()) {
    if (name === "index.json" || !name.endsWith(".json") || handle.kind !== "file") continue;
    try {
      const text = await readTextFile(dirHandle, name);
      const data = JSON.parse(text);
      if (data && data.id) {
        list.push(makeSummary(data));
      }
    } catch (e) {
      console.warn(`Failed to parse ${name} during OPFS rebuildIndex:`, e);
    }
  }
  list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  await writeTextFile(dirHandle, "index.json", JSON.stringify(list));
  return list;
}

/**
 * 楽曲を OPFS に保存する
 * @param {Object} songData
 * @param {FileSystemDirectoryHandle} [customRoot]
 * @returns {Promise<string>} 保存した song id
 */
export async function saveSong(songData, customRoot = null) {
  const dir = await getSongsDirectory(customRoot);
  const id = songData.id || `song_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const fullRecord = {
    ...songData,
    id,
    title: songData.title || songData.score?.title || "Untitled",
    createdAt: songData.createdAt || new Date().toISOString(),
  };

  // 1. 詳細ファイル保存
  await writeTextFile(dir, `${id}.json`, JSON.stringify(fullRecord));

  // 2. index.json 更新
  let list = [];
  try {
    const raw = await readTextFile(dir, "index.json");
    list = JSON.parse(raw);
    if (!Array.isArray(list)) list = [];
  } catch {
    list = [];
  }

  const summary = makeSummary(fullRecord);
  const existingIdx = list.findIndex((item) => item.id === id);
  if (existingIdx >= 0) {
    list[existingIdx] = summary;
  } else {
    list.unshift(summary);
  }
  list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  await writeTextFile(dir, "index.json", JSON.stringify(list));

  return id;
}

/**
 * 保存済み楽曲のサマリ一覧を取得 (作成日時の降順)
 * @param {FileSystemDirectoryHandle} [customRoot]
 * @returns {Promise<Array>}
 */
export async function listSongs(customRoot = null) {
  const dir = await getSongsDirectory(customRoot);
  try {
    const raw = await readTextFile(dir, "index.json");
    const list = JSON.parse(raw);
    if (Array.isArray(list)) {
      return list;
    }
  } catch {
    // index.json がない、または破損している場合は走査再構築
  }
  return await rebuildIndex(dir);
}

/**
 * 1曲の詳細データを取得 (score, midi, sections, request を含む完全データ)
 * @param {string} id
 * @param {FileSystemDirectoryHandle} [customRoot]
 * @returns {Promise<Object>}
 */
export async function loadSong(id, customRoot = null) {
  const dir = await getSongsDirectory(customRoot);
  const raw = await readTextFile(dir, `${id}.json`);
  return JSON.parse(raw);
}

/**
 * 1曲を削除する
 * @param {string} id
 * @param {FileSystemDirectoryHandle} [customRoot]
 * @returns {Promise<void>}
 */
export async function deleteSong(id, customRoot = null) {
  const dir = await getSongsDirectory(customRoot);
  try {
    await dir.removeEntry(`${id}.json`);
  } catch (e) {
    console.warn(`File ${id}.json not found or already deleted:`, e);
  }

  // index.json から除去
  try {
    const raw = await readTextFile(dir, "index.json");
    const list = JSON.parse(raw);
    if (Array.isArray(list)) {
      const nextList = list.filter((item) => item.id !== id);
      await writeTextFile(dir, "index.json", JSON.stringify(nextList));
      return;
    }
  } catch {}
  await rebuildIndex(dir);
}

/**
 * すべての保存済み楽曲を削除する
 * @param {FileSystemDirectoryHandle} [customRoot]
 * @returns {Promise<void>}
 */
export async function clearAllSongs(customRoot = null) {
  const root = customRoot || (await navigator.storage.getDirectory());
  try {
    // songs ディレクトリごと再帰削除
    await root.removeEntry("songs", { recursive: true });
  } catch (e) {
    console.warn("Could not remove songs directory directly:", e);
  }
  // 再作成
  await root.getDirectoryHandle("songs", { create: true });
}
