import MidiWriter from "midi-writer-js";
import type { Score } from "../score";

/** Score -> Standard MIDI File (バイト列) */
export function scoreToMidi(score: Score): Uint8Array {
  const tracks = score.tracks.map((t, i) => {
    const track = new MidiWriter.Track();
    if (i === 0) {
      track.setTempo(score.bpm);
      track.setTimeSignature(score.timeSignature[0], score.timeSignature[1], 24, 8);
    }
    track.addTrackName(t.name);
    track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: t.program, channel: (t.channel + 1) as never }));
    for (const n of t.notes) {
      track.addEvent(
        new MidiWriter.NoteEvent({
          pitch: [n.pitch],
          startTick: Math.round(n.start * 128),
          duration: "T" + Math.max(1, Math.round(n.duration * 128)),
          velocity: Math.round((n.velocity / 127) * 100),
          channel: (t.channel + 1) as never,
        }),
      );
    }
    return track;
  });
  return new MidiWriter.Writer(tracks).buildFile();
}
