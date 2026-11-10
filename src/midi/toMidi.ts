import MidiWriter from "midi-writer-js";
import type { Score } from "../score";

/**
 * Score -> Standard MIDI File (バイト列)
 *
 * 注意: midi-writer-js はイベント種別で channel の基準が異なる
 *  - NoteEvent は 1 始まり (内部で channel - 1 してステータスを作る)
 *  - ProgramChangeEvent は 0 始まり (そのまま status | channel)
 * ここを取り違えると音色チェンジだけ別チャンネルに載り、
 * 再生時に全パートが既定音色 (ピアノ) で鳴ってしまう。
 */
export function scoreToMidi(score: Score): Uint8Array {
  const tracks = score.tracks.map((t, i) => {
    const track = new MidiWriter.Track();
    if (i === 0) {
      track.setTempo(score.bpm);
      track.setTimeSignature(score.timeSignature[0], score.timeSignature[1], 24, 8);
    }
    track.addTrackName(t.name);
    // 0 始まりで渡す
    track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: t.program, channel: t.channel as never }));
    for (const n of t.notes) {
      track.addEvent(
        new MidiWriter.NoteEvent({
          pitch: [n.pitch],
          startTick: Math.round(n.start * 128),
          duration: "T" + Math.max(1, Math.round(n.duration * 128)),
          velocity: Math.round((n.velocity / 127) * 100),
          // 1 始まりで渡す
          channel: (t.channel + 1) as never,
        }),
      );
    }
    return track;
  });
  return new MidiWriter.Writer(tracks).buildFile();
}
