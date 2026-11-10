import { z } from "zod";

export const NoteSchema = z.object({
  pitch: z.number().int().min(0).max(127),
  start: z.number().min(0), // 拍単位
  duration: z.number().gt(0), // 拍単位
  velocity: z.number().int().min(1).max(127).default(90),
});

export const TrackSchema = z.object({
  name: z.string().default("Track"),
  program: z.number().int().min(0).max(127).default(0), // GM音色番号
  channel: z.number().int().min(0).max(15).default(0), // ドラムは 9
  notes: z.array(NoteSchema).min(1),
});

export const ScoreSchema = z.object({
  title: z.string().default("Untitled"),
  bpm: z.number().min(30).max(300),
  timeSignature: z.tuple([z.number().int().min(1), z.number().int()]).default([4, 4]),
  key: z.string().default("C major"),
  tracks: z.array(TrackSchema).min(1).max(32),
});

export type Note = z.infer<typeof NoteSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type Score = z.infer<typeof ScoreSchema>;
