export type SavedSongSummary = {
  id: string;
  title: string;
  createdAt: string;
  bpm: number;
  key: string;
  bars: number;
  loop: boolean;
  ensemble: string;
  prompt: string;
  noteCount: number;
};

export type SavedSong = {
  id: string;
  title: string;
  createdAt: string;
  request: {
    prompt: string;
    bars: number;
    loop: boolean;
    ensemble: string;
    creativity?: number;
    complexity?: string;
    seed?: number | null;
  };
  score: any;
  midi: string;
  sections?: any[];
  attempts?: number;
  stats?: any;
  complexity?: any;
};

export function isOpfsSupported(): boolean;
export function getSongsDirectory(customRoot?: any): Promise<any>;
export function saveSong(songData: Partial<SavedSong> & { score: any; midi: string }, customRoot?: any): Promise<string>;
export function listSongs(customRoot?: any): Promise<SavedSongSummary[]>;
export function loadSong(id: string, customRoot?: any): Promise<SavedSong>;
export function deleteSong(id: string, customRoot?: any): Promise<void>;
export function clearAllSongs(customRoot?: any): Promise<void>;
