"""Et tegneserietre: stamme, røtter og greiner som kurverør, løv av ekte blader (luna.mesh), epler og en stubbe med taper."""
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

# Løvsky: klumper på et skall rundt en kjerne. Klumpene er mørkt «fyll» (gir dybde mellom bladene), og utsiden
# dekkes av ekte blader (egne former, luna.mesh) som bryter det runde omrisset.
SENTER = (0.15, HOYDE + 0.95, 0.0)
FYLL = ["#3c8a36", "#44983d", "#4da645", "#57b24c"]
loev = luna.folder("Løv", parent=tre)
klumper = []  # (midtpunkt, diameter, retning fra SENTER)
ANTALL = 13
for i in range(ANTALL):
    y = 0.95 - 1.45 * (i + 0.5) / ANTALL
    r = math.sqrt(max(0.0, 1 - y * y))
    v = i * 2.39996 + 0.4  # gyllen vinkel gir jevn fordeling
    retning = (r * math.cos(v), y, r * math.sin(v))
    d = random.uniform(1.15, 1.6)
    klumper.append((tuple(SENTER[j] + retning[j] * (1.15 if j != 1 else 0.95) for j in range(3)), d, retning))
alle = [(pos, d / 2, d * 0.45) for pos, d, _ in klumper] + [(pts[-1], 0.6, 0.525) for pts in greiner]
ymin = min(c[1] - ry for c, _, ry in alle)
ymax = max(c[1] + ry for c, _, ry in alle)
hoyde = lambda y: max(0.0, min(1.0, (y - ymin) / (ymax - ymin)))

luna.sphere(name="Løvfyll kjerne", position=SENTER, scale=(2.4, 2.0, 2.3), color=FYLL[0], roughness=0.95, folder=loev)
for i, (c, rx, ry) in enumerate(alle):
    luna.sphere(name=f"Løvfyll {i + 1}", position=c, scale=(rx * 1.8, ry * 1.8, rx * 1.8),
                color=FYLL[min(3, int(hoyde(c[1]) * 4))], roughness=0.95, folder=loev)


def blandet(a, b, t):
    ca, cb = [int(a[i:i + 2], 16) for i in (1, 3, 5)], [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x + (y - x) * t):02x}" for x, y in zip(ca, cb))


def bladform(farge, lengde, bredde, fold=0.022, boy=0.06, tykk=0.008, seg=6):
    """Spisst blad langs +Z (stilken i origo) som vender +Y: fold langs midtribba, bøyer ned mot tuppen.
    Lys midtribbe og mørk underside via hjørnefarger. 48 trekanter."""
    lys, mork = blandet(farge, "#ffffff", 0.25), blandet(farge, "#000000", 0.35)
    V, C, T = [], [], []
    for i in range(seg + 1):
        t = i / seg
        w = bredde / 2 * math.sin(math.pi * t ** 0.75)
        z, ned = lengde * t, boy * t * t
        V += [(-w, -ned, z), (0.0, fold - ned, z), (w, -ned, z)]
        C += [farge, lys, farge]
    n = len(V)
    V += [(x, y - tykk, z) for x, y, z in V]  # undersiden
    C += [mork] * n
    for i in range(seg):
        L0, M0, R0, L1, M1, R1 = range(3 * i, 3 * i + 6)
        topp = [(M0, L0, L1), (M0, L1, M1), (R0, M0, M1), (R0, M1, R1)]
        T += topp + [(a + n, c + n, b + n) for a, b, c in topp]
    return dict(vertices=V, triangles=T, vertex_colors=C)


# 5 farger x 2 størrelser – alle bladene deler disse 10 formene (lagres én gang).
former = {(f, s): bladform(GRONN[f], *[(0.34, 0.17), (0.42, 0.2)][s]) for f in range(5) for s in range(2)}
bladmappe = luna.folder("Blader", parent=loev)
rb = random.Random(11)  # egen tilfeldighet, så resten av treet blir likt uansett antall blader


def enhet(v):
    l = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / l for x in v]


blader = 0
for i, (c, rx, ry) in enumerate(alle):
    antall = int(66 * (rx / 0.7) ** 2)
    for k in range(antall):
        t = 1 - 2 * (k + 0.5) / antall
        a = k * 2.39996 + i
        u = [math.sqrt(1 - t * t) * math.cos(a), t, math.sqrt(1 - t * t) * math.sin(a)]
        p = [c[0] + u[0] * rx, c[1] + u[1] * ry, c[2] + u[2] * rx]
        # Hopp over blader som ville vært skjult inni en annen klump.
        if any(j != i and ((p[0] - o[0]) / orx) ** 2 + ((p[1] - o[1]) / ory) ** 2 + ((p[2] - o[2]) / orx) ** 2 < 0.8
               for j, (o, orx, ory) in enumerate(alle)):
            continue
        n = enhet([u[0] / rx, u[1] / ry, u[2] / rx])
        opp = enhet([n[0], n[1] + 0.5, n[2]])                  # flaten vender litt mot lyset
        ut = enhet([p[0] - SENTER[0], -0.3, p[2] - SENTER[2]])  # tuppen peker utover og litt ned
        frem = enhet([ut[j] - sum(x * y for x, y in zip(ut, opp)) * opp[j] for j in range(3)])
        side = enhet([opp[1] * frem[2] - opp[2] * frem[1], opp[2] * frem[0] - opp[0] * frem[2], opp[0] * frem[1] - opp[1] * frem[0]])
        vri = math.radians(rb.uniform(-55, 55))
        frem = enhet([frem[j] * math.cos(vri) + side[j] * math.sin(vri) for j in range(3)])
        farge = max(0, min(4, int(hoyde(p[1]) * 4.5 + rb.choice([-1, 0, 0, 1]))))
        luna.mesh(name=f"Blad {blader + 1}", **former[(farge, rb.random() < 0.4)],
                  position=[p[j] + n[j] * 0.02 - frem[j] * 0.06 for j in range(3)],  # stilken litt inn i klumpen
                  rotation=luna.orient(forward=frem, up=opp), roughness=0.8, folder=bladmappe)
        blader += 1

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

print(f"Tre med {blader} blader og {epler} epler")
