# Генерация иконок FaceSwap: gradient tile + два "лица" + стрелки обмена
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons")
os.makedirs(OUT, exist_ok=True)

S = 512
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# фон: скруглённый квадрат с вертикальным градиентом
c1 = (109, 40, 217)   # фиолетовый
c2 = (6, 182, 212)    # циан
tile = Image.new("RGBA", (S, S), (0, 0, 0, 0))
td = ImageDraw.Draw(tile)
for y in range(S):
    t = y / S
    td.line([(0, y), (S, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(c1, c2)) + (255,))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S, S], radius=int(S * 0.22), fill=255)
img.paste(tile, (0, 0), mask)
d = ImageDraw.Draw(img)

WHITE = (255, 255, 255, 255)
DK = (30, 27, 75, 255)

# лицо 1 (слева вверху) — контур
d.ellipse([S*0.16, S*0.18, S*0.52, S*0.54], outline=WHITE, width=int(S*0.045))
d.ellipse([S*0.27, S*0.29, S*0.335, S*0.355], fill=WHITE)   # глаз
d.ellipse([S*0.38, S*0.29, S*0.445, S*0.355], fill=WHITE)
d.arc([S*0.28, S*0.36, S*0.44, S*0.48], start=20, end=160, fill=WHITE, width=int(S*0.025))

# лицо 2 (справа внизу) — заливка
d.ellipse([S*0.48, S*0.46, S*0.84, S*0.82], fill=WHITE)
d.ellipse([S*0.57, S*0.575, S*0.63, S*0.635], fill=DK)
d.ellipse([S*0.685, S*0.575, S*0.745, S*0.635], fill=DK)
d.arc([S*0.575, S*0.62, S*0.745, S*0.75], start=20, end=160, fill=DK, width=int(S*0.022))

# стрелки обмена между лицами
aw = int(S * 0.032)
d.line([S*0.62, S*0.30, S*0.86, S*0.30], fill=WHITE, width=aw)
d.polygon([(S*0.86, S*0.30), (S*0.79, S*0.255), (S*0.79, S*0.345)], fill=WHITE)
d.line([S*0.38, S*0.70, S*0.14, S*0.70], fill=WHITE, width=aw)
d.polygon([(S*0.14, S*0.70), (S*0.21, S*0.655), (S*0.21, S*0.745)], fill=WHITE)

for size in (32, 128, 256, 512):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, f"{size}x{size}.png"))
img.save(os.path.join(OUT, "icon.png"))
img.save(
    os.path.join(OUT, "icon.ico"),
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print("icons ->", os.path.abspath(OUT))
