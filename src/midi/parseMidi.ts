/**
 * 依存なしの Standard MIDI File パーサー (format 0 / 1)。
 * 解析専用: ノート・テンポ・拍子・音色を読み、必要最小限の情報だけ返す。
 * 書き出しは midi/toMidi.ts が担当する。
 */

export type ParsedNote = {
  pitch: number;
  /** 曲頭からの秒 (テンポマップ適用済み) */
  start: number;
  duration: number;
  velocity: number;
  channel: number;
  program: number;
  /** 生のtick。拍は tick / division で求める */
  tick: number;
  durationTicks: number;
};

export type ParsedTrack = { name: string; notes: ParsedNote[]; programs: number[]; channels: number[] };

export type TempoEvent = { tick: number; bpm: number };
export type TimeSignatureEvent = { tick: number; numerator: number; denominator: number };

export type ParsedMidi = {
  format: number;
  /** ticks per quarter note */
  division: number;
  tracks: ParsedTrack[];
  tempos: TempoEvent[];
  timeSignatures: TimeSignatureEvent[];
  durationTicks: number;
  durationSeconds: number;
};

const readVarLen = (data: Uint8Array, pos: number): { value: number; next: number } => {
  let value = 0;
  let p = pos;
  for (let i = 0; i < 4; i++) {
    const byte = data[p++]!;
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) break;
  }
  return { value, next: p };
};

const readU32 = (data: Uint8Array, pos: number) =>
  ((data[pos]! << 24) | (data[pos + 1]! << 16) | (data[pos + 2]! << 8) | data[pos + 3]!) >>> 0;

const readU16 = (data: Uint8Array, pos: number) => (data[pos]! << 8) | data[pos + 1]!;

const ascii = (data: Uint8Array, pos: number, len: number) => {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(data[pos + i] ?? 0);
  return s;
};

type RawNote = { pitch: number; startTick: number; endTick: number; velocity: number; channel: number };

export function parseMidi(bytes: Uint8Array): ParsedMidi {
  if (bytes.length < 14 || ascii(bytes, 0, 4) !== "MThd") throw new Error("Not a Standard MIDI File (missing MThd)");
  const headerLen = readU32(bytes, 4);
  const format = readU16(bytes, 8);
  const nTracks = readU16(bytes, 10);
  const divisionRaw = readU16(bytes, 12);
  if (divisionRaw & 0x8000) throw new Error("SMPTE time division is not supported");
  const division = divisionRaw || 480;

  let pos = 8 + headerLen;
  const tempos: TempoEvent[] = [];
  const timeSignatures: TimeSignatureEvent[] = [];
  const rawTracks: { name: string; notes: RawNote[]; programs: number[]; channels: number[]; programChanges: { tick: number; channel: number; program: number }[] }[] = [];

  for (let t = 0; t < nTracks && pos + 8 <= bytes.length; t++) {
    const id = ascii(bytes, pos, 4);
    const len = readU32(bytes, pos + 4);
    const start = pos + 8;
    const end = Math.min(bytes.length, start + len);
    pos = end;
    if (id !== "MTrk") continue;

    let p = start;
    let tick = 0;
    let runningStatus = 0;
    let name = "";
    const notes: RawNote[] = [];
    const programs: number[] = [];
    const channels = new Set<number>();
    const programChanges: { tick: number; channel: number; program: number }[] = [];
    /** channel:pitch -> stack of pending note-ons */
    const active = new Map<string, { startTick: number; velocity: number }[]>();
    const channelProgram = new Map<number, number>();

    while (p < end) {
      const delta = readVarLen(bytes, p);
      tick += delta.value;
      p = delta.next;
      if (p >= end) break;
      let status = bytes[p]!;
      if (status < 0x80) {
        // ランニングステータス
        status = runningStatus;
        if (status === 0) throw new Error("Running status without a previous status byte");
      } else {
        p++;
        if (status < 0xf0) runningStatus = status;
      }

      const type = status & 0xf0;
      const channel = status & 0x0f;

      if (status === 0xff) {
        const metaType = bytes[p++]!;
        const len2 = readVarLen(bytes, p);
        p = len2.next;
        const dataStart = p;
        p += len2.value;
        if (metaType === 0x03 && name === "") name = ascii(bytes, dataStart, len2.value).trim();
        else if (metaType === 0x51 && len2.value >= 3) {
          const micro = (bytes[dataStart]! << 16) | (bytes[dataStart + 1]! << 8) | bytes[dataStart + 2]!;
          if (micro > 0) tempos.push({ tick, bpm: 60_000_000 / micro });
        } else if (metaType === 0x58 && len2.value >= 2) {
          timeSignatures.push({ tick, numerator: bytes[dataStart]!, denominator: 2 ** bytes[dataStart + 1]! });
        } else if (metaType === 0x2f) break;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        const len2 = readVarLen(bytes, p);
        p = len2.next + len2.value;
        continue;
      }

      channels.add(channel);
      switch (type) {
        case 0x90: {
          const pitch = bytes[p++]!;
          const velocity = bytes[p++]!;
          if (velocity === 0) {
            closeNote(active, notes, channel, pitch, tick);
          } else {
            const key = `${channel}:${pitch}`;
            const stack = active.get(key);
            const entry = { startTick: tick, velocity };
            if (stack) stack.push(entry); else active.set(key, [entry]);
          }
          break;
        }
        case 0x80: {
          const pitch = bytes[p++]!;
          p++; // release velocity
          closeNote(active, notes, channel, pitch, tick);
          break;
        }
        case 0xa0: p += 2; break;
        case 0xb0: p += 2; break;
        case 0xc0: {
          const program = bytes[p++]!;
          programs.push(program);
          programChanges.push({ tick, channel, program });
          break;
        }
        case 0xd0: p += 1; break;
        case 0xe0: p += 2; break;
        default: p = end; break;
      }
    }

    // 閉じられなかったノートはトラック末尾で閉じる
    for (const [key, stack] of active) {
      const [ch, pitch] = key.split(":");
      for (const entry of stack) notes.push({ pitch: Number(pitch), startTick: entry.startTick, endTick: tick, velocity: entry.velocity, channel: Number(ch) });
    }

    rawTracks.push({
      name,
      notes,
      programs: [...new Set(programs)],
      channels: [...channels],
      programChanges: programChanges.sort((a, b) => a.tick - b.tick),
    });
  }

  // tempo map: tick -> 秒
  const sortedTempos = tempos.length > 0 ? [...tempos].sort((a, b) => a.tick - b.tick) : [{ tick: 0, bpm: 120 }];
  const tickToSeconds = (target: number): number => {
    let seconds = 0;
    let lastTick = 0;
    let bpm = sortedTempos[0]!.bpm;
    for (const ev of sortedTempos) {
      if (ev.tick >= target) break;
      seconds += ((ev.tick - lastTick) / division) * (60 / bpm);
      lastTick = ev.tick;
      bpm = ev.bpm;
    }
    seconds += ((target - lastTick) / division) * (60 / bpm);
    return seconds;
  };

  // ノート開始順に並べ、秒を付与
  const endTick = rawTracks.reduce((max, rt) => Math.max(max, ...rt.notes.map((n) => n.endTick), 0), 0);
  const tracks: ParsedTrack[] = rawTracks.map((rt) => {
    const ordered = [...rt.notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);

    // チャンネルごとの音色チェンジを時系列に当てはめる
    const perChannel = new Map<number, { tick: number; program: number }[]>();
    for (const pc of rt.programChanges) {
      const list = perChannel.get(pc.channel);
      if (list) list.push({ tick: pc.tick, program: pc.program });
      else perChannel.set(pc.channel, [{ tick: pc.tick, program: pc.program }]);
    }
    const programAt = (channel: number, tick: number): number => {
      const list = perChannel.get(channel);
      if (!list) return 0;
      let program = 0;
      for (const pc of list) {
        if (pc.tick <= tick) program = pc.program; else break;
      }
      return program;
    };

    return {
      name: rt.name,
      programs: rt.programs,
      channels: rt.channels,
      notes: ordered.map((raw) => ({
        pitch: raw.pitch,
        start: tickToSeconds(raw.startTick),
        duration: Math.max(1 / 64, tickToSeconds(Math.max(raw.endTick, raw.startTick + 1)) - tickToSeconds(raw.startTick)),
        velocity: raw.velocity,
        channel: raw.channel,
        program: programAt(raw.channel, raw.startTick),
        tick: raw.startTick,
        durationTicks: Math.max(1, raw.endTick - raw.startTick),
      })),
    };
  });

  return {
    format, division, tracks,
    tempos: sortedTempos,
    timeSignatures: timeSignatures.length > 0 ? [...timeSignatures].sort((a, b) => a.tick - b.tick) : [{ tick: 0, numerator: 4, denominator: 4 }],
    durationTicks: endTick,
    durationSeconds: tickToSeconds(endTick),
  };
}

function closeNote(active: Map<string, { startTick: number; velocity: number }[]>, out: RawNote[], channel: number, pitch: number, tick: number) {
  const key = `${channel}:${pitch}`;
  const stack = active.get(key);
  if (!stack || stack.length === 0) return;
  const entry = stack.pop()!;
  if (tick > entry.startTick) out.push({ pitch, startTick: entry.startTick, endTick: tick, velocity: entry.velocity, channel });
}
