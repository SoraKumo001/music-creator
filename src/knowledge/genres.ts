/** ジャンル別知識カード。プロンプトに注入する短い指針 */
export type GenreCard = {
  id: string;
  keywords: string[];
  card: string;
  /** knowledge/progressions.ts の進行カード ID */
  progressions?: string[];
};

export const GENRES: GenreCard[] = [
  {
    id: "lofi",
    keywords: ["lofi", "lo-fi", "ローファイ", "チル", "chill"],
    card: "Tempo 70-90 BPM, swung feel. Chords: Imaj7-vi7-ii7-V7 or ii7-V7-Imaj7 with 7th/9th voicings. Drums: kick on 1 and 3-and, snare on 2 and 4 (soft), closed hats on 8ths with low velocity variation. Instruments: electric piano (program 4), mellow bass (33), light drums (channel 9).",
    progressions: ["jazz-turnaround", "lofi-maj7", "jazz-251"],
  },
  {
    id: "rock",
    keywords: ["rock", "ロック", "バンド"],
    card: "Tempo 110-150 BPM. Chords: I-V-vi-IV or I-IV-V power chords. Drums: kick 1 and 3, snare 2 and 4, 8th-note hats. Instruments: overdriven guitar (29), bass (33) following root notes in 8ths, drums.",
    progressions: ["rock-145", "rock-minor", "rock-andalusian", "pop-1564"],
  },
  {
    id: "classical",
    keywords: ["classical", "クラシック", "ピアノ曲", "piano"],
    card: "Tempo varies (Andante 76-108). Use clear phrases of 4 bars, antecedent-consequent structure, cadence to tonic at the end (V-I). Voice leading by step. Instruments: piano (0) with left-hand broken-chord accompaniment and right-hand melody; or strings (48).",
    progressions: ["classical-145", "pop-canon", "classical-circle"],
  },
  {
    id: "edm",
    keywords: ["edm", "techno", "house", "ダンス", "エレクトロ"],
    card: "Tempo 120-135 BPM. Four-on-the-floor kick on every beat, off-beat open hats, clap/snare on 2 and 4. Chords: vi-IV-I-V, minor key. Instruments: saw lead (81), pad (89), synth bass (38) with 16th-note patterns.",
    progressions: ["jpop-6415", "rock-minor", "pop-1564"],
  },
  {
    id: "jazz",
    keywords: ["jazz", "ジャズ", "スウィング"],
    card: "Tempo 100-180 BPM, swing 8ths. Chords: ii7-V7-Imaj7 turnarounds. Walking bass (32) in quarter notes outlining chord tones, ride cymbal pattern, piano (0) comping with 7th chords. Melody uses chord tones on strong beats and passing tones in between.",
    progressions: ["jazz-251", "jazz-turnaround", "jazz-rhythm", "jazz-251-minor"],
  },
  {
    id: "ballad",
    keywords: ["ballad", "バラード", "しっとり", "感動", "泣ける", "明るい", "楽しい", "元気", "ポップ", "pop", "pops", "アニソン", "アイドル"],
    card: "Tempo 70-110 BPM. Chords: I-V-vi-IV or vi-IV-I-V, IV-V-vi for pre-chorus lift. Drums: soft basic pattern, crash on section heads. Instruments: piano (0) or strings (48), bass (33) on roots.",
    progressions: ["pop-1564", "pop-1465", "jpop-6415", "jpop-prechorus"],
  },
  {
    id: "funk",
    keywords: ["funk", "ファンク", "soul", "ソウル", "bossa", "ボサノバ", "samba", "サンバ", "citypop", "シティポップ"],
    card: "Tempo 85-115 BPM, syncopated 16ths. Chords: maj7/7th voicings with III7-VI7 turnarounds. Drums: swung hats or four-on-floor lite. Instruments: electric piano (4), mellow bass with passing tones, light drums.",
    progressions: ["jpop-marusa", "citypop-maj7", "jazz-turnaround", "lofi-maj7"],
  },
  {
    id: "game",
    keywords: ["game", "ゲーム", "rpg", "イース", "ys", "ファルコム", "falcom", "古代", "fm", "レトロ", "シンセロック", "バトル", "戦闘", "フィールド"],
    card: "Tempo 120-155 BPM. Dramatic minor or heroic major key. 80s/90s FM-synth rock style (Ys / Falcom / Yuzo Koshiro feel). Intro starts with fast 16th-note broken-chord sequence (comp: 'arpeggio16', bass: 'pedal', drums: 'none'). Verses/chorus drive with 16th-note high-energy drums (drums: 'game16th') and driving slap/synth bass (bass: 'sixteenths'). Instruments: square lead (80) or overdriven guitar (29), slap bass (37) or synth bass (38), polysynth pad (98) or guitar (29).",
    progressions: ["jpop-komuro", "jpop-oudou", "rock-minor", "jpop-6415"],
  },
];

export function pickGenreCards(prompt: string): GenreCard[] {
  const p = prompt.toLowerCase();
  return GENRES.filter((g) => g.keywords.some((k) => p.includes(k.toLowerCase())));
}
