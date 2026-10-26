"""Et tegneserietre: stamme, røtter og greiner som kurverør, løvsky av kuler, epler og en stubbe med taper."""
import math
import random

import luna3d as luna

random.seed(7)  # samme tre hver gang – bytt tallet for et annet
HOYDE = 2.8  # toppen av stammen
BARK, BARK_MORK = "#8a5a3b", "#6e4630"
GRONN = ["#3f9a3a", "#4fae43", "#62c24f", "#7ad65e", "#93e270"]  # mørk nede -> lys oppe

tre = luna.folder("Tegneserietre")
luna.hemisphere(name="Gresstue", position=(0, 0.2, 0), scale=(3.6, 0.4, 3.6), color="#8fd16a", roughness=1, folder=tre)

# Stammen er ett rør som bøyer seg litt og smalner oppover (én radius per punkt).
luna.curve(name="Stamme", points=[(0, 0.2, 0), (0.08, 1.0, 0), (0.25, 1.9, 0.02), (0.2, HOYDE, 0)],
           radius=[0.36, 0.27, 0.21, 0.17], color=BARK, roughness=0.9, folder=tre)

# Røttene starter inne i stammen, så de ser ut til å vokse ut av den.
for k in range(5):
    v = math.radians(k * 72 + 15)
    c, s = math.cos(v), -math.sin(v)
    luna.curve(name=f"Rot {k + 1}",
               points=[(0, 0.75, 0), (c * 0.35, 0.45, s * 0.35), (c * 0.75, 0.32, s * 0.75), (c * 1.0, 0.18, s * 1.0)],
               radius=[0.16, 0.12, 0.07, 0.03], color=BARK, roughness=0.9, folder=tre)

greiner = [
    [(0.15, 1.7, 0), (-0.35, 2.3, 0.1), (-0.85, 2.85, 0.25), (-1.05, 3.05, 0.25)],
    [(0.22, 2.0, 0), (0.7, 2.5, -0.1), (1.05, 3.0, -0.2), (1.25, 3.2, -0.2)],
    [(0.22, 2.4, 0), (0.2, 2.9, 0.5), (0.1, 3.4, 0.95)],
]
for i, pts in enumerate(greiner):
    radius = [0.13, 0.09, 0.06][: len(pts) - 1] + [0.05]
    luna.curve(name=f"Gren {i + 1}", points=pts, radius=radius, color=BARK, roughness=0.9, folder=tre)

# Løvsky: stor kjerne + klumper på et skall; lysere jo høyere klumpen sitter.
SENTER = (0.15, HOYDE + 0.95, 0.0)
luna.sphere(name="Løv kjerne", position=SENTER, scale=(2.5, 2.1, 2.4), color=GRONN[1], roughness=0.85, folder=tre)
klumper = []
ANTALL = 13
for i in range(ANTALL):
    y = 0.95 - 1.45 * (i + 0.5) / ANTALL
    r = math.sqrt(max(0.0, 1 - y * y))
    v = i * 2.39996 + 0.4  # gyllen vinkel gir jevn fordeling
    retning = (r * math.cos(v), y, r * math.sin(v))
    d = random.uniform(1.15, 1.6)
    pos = tuple(SENTER[j] + retning[j] * (1.15 if j != 1 else 0.95) for j in range(3))
    farge = GRONN[min(4, max(0, int((y + 0.5) / 1.45 * 5)))]
    luna.sphere(name=f"Løv {i + 1}", position=pos, scale=(d, d * 0.9, d), color=farge, roughness=0.85, folder=tre)
    klumper.append((pos, d, retning))
for i, pts in enumerate(greiner):
    luna.sphere(name=f"Løv greinende {i + 1}", position=pts[-1], scale=(1.2, 1.05, 1.2), color=GRONN[1], roughness=0.85, folder=tre)

# Epler på overflaten av de nederste klumpene, med en bøyd stilk.
epler = 0
for pos, d, (rx, ry, rz) in klumper:
    if ry > 0.3 or epler >= 8:
        continue
    lengde = math.sqrt(rx * rx + ry * ry + rz * rz)
    ut = 0.5 * d * 1.02
    p = (pos[0] + rx / lengde * ut, pos[1] + ry / lengde * ut * 0.9, pos[2] + rz / lengde * ut)
    luna.sphere(name=f"Eple {epler + 1}", position=p, scale=(0.26, 0.24, 0.26), color="#e5483f", roughness=0.35, folder=tre)
    luna.curve(name=f"Eplestilk {epler + 1}",
               points=[(p[0], p[1] + 0.08, p[2]), (p[0] + 0.03, p[1] + 0.17, p[2]), (p[0] + 0.07, p[1] + 0.21, p[2])],
               radius=[0.018, 0.015, 0.012], color=BARK_MORK, folder=tre)
    epler += 1

# Stubbe: sylinder som smalner litt oppover (taper = toppens bredde i forhold til bunnen).
luna.cylinder(name="Stubbe", position=(-1.15, 0.5, 0.9), scale=(0.55, 0.45, 0.55), taper=0.75, color=BARK, roughness=0.9, folder=tre)
luna.cylinder(name="Stubbe topp", position=(-1.15, 0.73, 0.9), scale=(0.42, 0.02, 0.42), color="#d9b07a", folder=tre)

luna.sphere(name="Falt eple", position=(0.95, 0.38, 0.75), scale=(0.26, 0.24, 0.26), color="#e5483f", roughness=0.35, folder=tre)
for k in range(9):
    v = random.uniform(0, math.tau)
    rad = random.uniform(0.9, 1.6)
    for s in range(3):
        luna.cone(name=f"Gress {k + 1}.{s + 1}", position=(math.cos(v) * rad + (s - 1) * 0.06, 0.4, -math.sin(v) * rad),
                  rotation=((s - 1) * 14, 0, (s - 1) * -18), scale=(0.07, 0.26, 0.07), color="#5fb84a", folder=tre)

print(f"Tre med {epler} epler")
