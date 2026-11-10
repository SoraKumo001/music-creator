"""OGP画像 (1200x630) を生成する。
   python scripts/make-ogp.py
"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import math, random

W, H = 1200, 630
OUT = "public/ogp.png"

# フォント (Windows標準の日本語フォント)
FONT_BOLD = "C:/Windows/Fonts/YuGothB.ttc"
FONT_MED = "C:/Windows/Fonts/YuGothM.ttc"
FONT_LATIN = "C:/Windows/Fonts/segoeuib.ttf"
FONT_SYMBOL = "C:/Windows/Fonts/seguisym.ttf"


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        try:
            return ImageFont.truetype("C:/Windows/Fonts/meiryob.ttc", size)
        except Exception:
            return ImageFont.load_default()


# 背景: 紺→深緑のグラデーション
img = Image.new("RGB", (W, H), (10, 14, 28))
px = img.load()
for y in range(H):
    for x in range(W):
        t = (x / W) * 0.55 + (y / H) * 0.45
        r = int(12 + 20 * t)
        g = int(18 + 34 * t)
        b = int(38 + 52 * t)
        px[x, y] = (r, g, b)

draw = ImageDraw.Draw(img, "RGBA")

# 五線っぽい横線
for i in range(9):
    y = 70 + i * 22
    draw.line([(60, y), (W - 60, y)], fill=(255, 255, 255, 10), width=1)

# 波形 (曲のイメージ)
random.seed(7)
points = []
for x in range(0, W, 6):
    t = x / W
    amp = 46 * math.sin(t * math.pi * 2.2) + 22 * math.sin(t * math.pi * 5.1 + 1.1)
    points.append((x, 516 + amp * 0.35 * math.sin(t * 3.0)))
draw.line(points, fill=(96, 165, 250, 90), width=4)

# 音符 (♪) を散らす
note_font = font(FONT_SYMBOL, 120)
for (x, y, s, a) in [(880, 80, 1.0, 34), (1010, 220, 0.7, 26), (760, 300, 0.55, 20)]:
    layer = Image.new("RGBA", (220, 220), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.text((20, 10), "♪", font=note_font, fill=(147, 197, 253, a))
    if s != 1.0:
        layer = layer.resize((int(220 * s), int(220 * s)), Image.LANCZOS)
    img.paste(layer, (x, y), layer)

# ピアノ鍵盤 (下端)
key_w, key_h = 48, 84
for i, x in enumerate(range(0, W, key_w)):
    draw.rectangle([x, H - key_h, x + key_w - 2, H], fill=(240, 244, 250, 235))
    if i % 7 in (0, 1, 3, 4, 5):
        draw.rectangle([x + key_w - 22, H - key_h, x + key_w - 8, H - key_h + 46], fill=(24, 28, 40, 255))

# 左上のロゴマーク (音階を模した三角)
draw.polygon([(72, 96), (118, 96), (118, 142)], fill=(96, 165, 250, 255))
draw.rectangle([72, 142, 96, 166], fill=(147, 197, 253, 255))

# テキスト
f_title = font(FONT_LATIN, 92)
f_sub = font(FONT_BOLD, 44)
f_desc = font(FONT_MED, 30)
f_chip = font(FONT_MED, 24)
f_domain = font(FONT_LATIN, 24)

draw.text((72, 186), "Music Creator", font=f_title, fill=(255, 255, 255, 255))
draw.text((78, 300), "AIが作曲して、MIDIで出力。", font=f_sub, fill=(191, 219, 254, 255))
draw.text((78, 366), "コード進行・メロディ・伴奏まで一括生成。試聴して保存できます。",
          font=f_desc, fill=(203, 213, 225, 235))

# 特徴チップ
chips = ["コード進行", "メロディ生成", "試聴・MIDI保存"]
x = 78
y = 424
for label in chips:
    tw = draw.textlength(label, font=f_chip)
    draw.rounded_rectangle([x, y, x + tw + 36, y + 52], radius=26,
                           fill=(30, 41, 59, 220), outline=(96, 165, 250, 140), width=2)
    draw.text((x + 18, y + 9), label, font=f_chip, fill=(224, 231, 255, 255))
    x += tw + 52

# 右下のドメイン風テキスト
draw.text((W - 70, H - 130), "music-creator", font=f_domain,
          fill=(148, 163, 184, 220), anchor="ra")

img.save(OUT, "PNG", optimize=True)
print(f"wrote {OUT} ({img.size[0]}x{img.size[1]})")

