import { describe, expect, it } from "vitest";
import {
  clearAllSongs,
  deleteSong,
  getSongsDirectory,
  listSongs,
  loadSong,
  saveSong,
} from "../public/opfs-storage.js";

/** インメモリの FileSystemHandle モック */
class MockFileHandle {
  kind = "file";
  content = "";
  constructor(public name: string) {}

  async createWritable() {
    return {
      write: async (data: string) => {
        this.content = data;
      },
      close: async () => {},
    };
  }

  async getFile() {
    return {
      text: async () => this.content,
    };
  }
}

class MockDirectoryHandle {
  kind = "directory";
  entriesMap = new Map<string, MockDirectoryHandle | MockFileHandle>();

  constructor(public name = "root") {}

  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    let dir = this.entriesMap.get(name);
    if (!dir && opts?.create) {
      dir = new MockDirectoryHandle(name);
      this.entriesMap.set(name, dir);
    }
    if (!dir || dir.kind !== "directory") throw new Error(`Directory ${name} not found`);
    return dir as MockDirectoryHandle;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    let file = this.entriesMap.get(name);
    if (!file && opts?.create) {
      file = new MockFileHandle(name);
      this.entriesMap.set(name, file);
    }
    if (!file || file.kind !== "file") throw new Error(`File ${name} not found`);
    return file as MockFileHandle;
  }

  async removeEntry(name: string, _opts?: { recursive?: boolean }) {
    if (!this.entriesMap.has(name)) throw new Error(`Entry ${name} not found`);
    this.entriesMap.delete(name);
  }

  async *entries() {
    for (const entry of this.entriesMap.entries()) {
      yield entry;
    }
  }
}

describe("OPFS Storage Module", () => {
  const songSample1 = {
    id: "song_1",
    title: "疾走ロック",
    createdAt: "2026-11-10T10:00:00.000Z",
    request: { prompt: "疾走感のあるロック", bars: 16, loop: false, ensemble: "band" },
    score: {
      title: "疾走ロック",
      bpm: 164,
      key: "E minor",
      timeSignature: [4, 4],
      tracks: [{ name: "Lead", notes: [{ pitch: 72, start: 0, duration: 1 }] }],
    },
    midi: "TVRoZAAAAAY...",
    sections: [{ name: "Verse", startBar: 0, bars: 4, role: "verse" }],
  };

  const songSample2 = {
    id: "song_2",
    title: "夜のローファイ",
    createdAt: "2026-11-10T11:00:00.000Z",
    request: { prompt: "静かなローファイ", bars: 8, loop: true, ensemble: "band" },
    score: {
      title: "夜のローファイ",
      bpm: 76,
      key: "Eb major",
      timeSignature: [4, 4],
      tracks: [{ name: "Piano", notes: [{ pitch: 60, start: 0, duration: 2 }] }],
    },
    midi: "TVRoZAAAAAY...",
    sections: [{ name: "A", startBar: 0, bars: 8, role: "verse" }],
  };

  it("creates songs directory if not exists", async () => {
    const root = new MockDirectoryHandle();
    const dir = await getSongsDirectory(root);
    expect(dir.name).toBe("songs");
    expect(root.entriesMap.has("songs")).toBe(true);
  });

  it("saves songs and updates index.json in descending date order", async () => {
    const root = new MockDirectoryHandle();
    const id1 = await saveSong(songSample1, root);
    expect(id1).toBe("song_1");

    const id2 = await saveSong(songSample2, root);
    expect(id2).toBe("song_2");

    const list = await listSongs(root);
    expect(list).toHaveLength(2);
    // 降順なので song_2 (11:00) が先頭
    expect(list[0]!.id).toBe("song_2");
    expect(list[0]!.title).toBe("夜のローファイ");
    expect(list[0]!.bpm).toBe(76);
    expect(list[0]!.loop).toBe(true);

    expect(list[1]!.id).toBe("song_1");
    expect(list[1]!.title).toBe("疾走ロック");
    expect(list[1]!.bpm).toBe(164);
  });

  it("loads full song data by id", async () => {
    const root = new MockDirectoryHandle();
    await saveSong(songSample1, root);

    const loaded = await loadSong("song_1", root);
    expect(loaded.title).toBe("疾走ロック");
    expect(loaded.score.bpm).toBe(164);
    expect(loaded.sections).toHaveLength(1);
    expect(loaded.sections![0]!.role).toBe("verse");
    expect(loaded.request.prompt).toBe("疾走感のあるロック");
  });

  it("deletes a single song and updates index.json", async () => {
    const root = new MockDirectoryHandle();
    await saveSong(songSample1, root);
    await saveSong(songSample2, root);

    await deleteSong("song_1", root);

    const list = await listSongs(root);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe("song_2");

    const dir = await getSongsDirectory(root);
    expect(dir.entriesMap.has("song_1.json")).toBe(false);
  });

  it("rebuilds index if index.json is missing or corrupted", async () => {
    const root = new MockDirectoryHandle();
    await saveSong(songSample1, root);
    await saveSong(songSample2, root);

    // index.json を壊す
    const dir = await getSongsDirectory(root);
    const indexFile = (await dir.getFileHandle("index.json")) as MockFileHandle;
    indexFile.content = "invalid-json";

    const list = await listSongs(root);
    expect(list).toHaveLength(2);
    expect(list.map((s: { id: string }) => s.id).sort()).toEqual(["song_1", "song_2"]);
  });

  it("clears all songs and resets directory", async () => {
    const root = new MockDirectoryHandle();
    await saveSong(songSample1, root);
    await saveSong(songSample2, root);

    await clearAllSongs(root);

    const list = await listSongs(root);
    expect(list).toHaveLength(0);
  });
});
