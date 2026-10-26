"""Tegneserietre der krona bare er blader: tre lag (lyst ytterst, mørkt innerst) i stedet for fyllkuler."""
import math
import random

import luna3d as luna

random.seed(7)
HOYDE = 2.8
BARK, BARK_MORK = "#8a5a3b", "#6e4630"
YTRE = ["#3f9a3a", "#4aa940", "#58b94b", "#6ac957", "#80d866"]  # lyst ytterst, lysere jo høyere
MIDT = ["#357f30", "#3c8c36", "#44993c"]
INDRE = ["#2a6526", "#30712b"]

tre = luna.folder("Tegneserietre")
luna.hemisphere(name="Gresstue", position=(0, 0.2, 0), scale=(3.6, 0.4, 3.6), color="#8fd16a", roughness=1, folder=tre)
luna.curve(name="Stamme", points=[(0, 0.2, 0), (0.08, 1.0, 0), (0.25, 1.9, 0.02), (0.2, HOYDE, 0)],
           radius=[0.36, 0.27, 0.21, 0.17], color=BARK, roughness=0.9, folder=tre)
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
    luna.curve(name=f"Gren {i + 1}", points=pts, radius=[0.13, 0.09, 0.06][: len(pts) - 1] + [0.05],
               color=BARK, roughness=0.9, folder=tre)

# ---------- Krona: klumper som bare fylles med blader ----------
SENTER = (0.15, HOYDE + 0.95, 0.0)
klumper = []  # (midtpunkt, radius xz, radius y)
for i in range(13):
    y = 0.95 - 1.45 * (i + 0.5) / 13
    r = math.sqrt(max(0.0, 1 - y * y))
    v = i * 2.39996 + 0.4
    d = random.uniform(1.15, 1.6)
    klumper.append(((SENTER[0] + r * math.cos(v) * 1.15, SENTER[1] + y * 0.95, SENTER[2] + r * math.sin(v) * 1.15), d / 2, d * 0.45))
klumper += [(pts[-1], 0.6, 0.525) for pts in greiner]
KJERNE = (SENTER, 1.15, 0.95)  # midten av krona – bare indre lag, så man ikke ser tvers gjennom
ymin = min(c[1] - ry for c, _, ry in klumper)
ymax = max(c[1] + ry for c, _, ry in klumper)
hoyde = lambda y: max(0.0, min(1.0, (y - ymin) / (ymax - ymin)))


def blandet(a, b, t):
    ca, cb = [int(a[i:i + 2], 16) for i in (1, 3, 5)], [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x + (y - x) * t):02x}" for x, y in zip(ca, cb))


def bladform(farge, lengde, bredde, fold=0.022, boy=0.06, tykk=0.008, seg=6):
    lys, mork = blandet(farge, "#ffffff", 0.25), blandet(farge, "#000000", 0.35)
    V, C, T = [], [], []
    for i in range(seg + 1):
        t = i / seg
        w = bredde / 2 * math.sin(math.pi * t ** 0.75)
        z, ned = lengde * t, boy * t * t
        V += [(-w, -ned, z), (0.0, fold - ned, z), (w, -ned, z)]
        C += [farge, lys, farge]
    n = len(V)
    V += [(x, y - tykk, z) for x, y, z in V]
    C += [mork] * n
    for i in range(seg):
        L0, M0, R0, L1, M1, R1 = range(3 * i, 3 * i + 6)
        topp = [(M0, L0, L1), (M0, L1, M1), (R0, M0, M1), (R0, M1, R1)]
        T += topp + [(a + n, c + n, b + n) for a, b, c in topp]
    return dict(vertices=V, triangles=T, vertex_colors=C)


STORRELSER = [(0.34, 0.17), (0.42, 0.2)]
former = {}


def form(farge, stor):
    key = (farge, stor)
    if key not in former:
        former[key] = bladform(farge, *STORRELSER[stor])
    return former[key]


def enhet(v):
    l = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / l for x in v]


def inni(p, c, rx, ry):
    return ((p[0] - c[0]) / rx) ** 2 + ((p[1] - c[1]) / ry) ** 2 + ((p[2] - c[2]) / rx) ** 2


loev = luna.folder("Løv", parent=tre)
LAG = [  # (navn, andel av radius, tetthet, grense for «inni en annen klump», farger)
    ("Ytre", 1.0, 66, 0.8, YTRE),
    ("Midtre", 0.72, 40, 0.55, MIDT),
    ("Indre", 0.45, 24, 0.3, INDRE),
]
rb = random.Random(11)
TONE = [rb.choice([-1, 0, 1]) for _ in klumper]
antall = {}
for navn, s, tetthet, grense, farger in LAG:
    mappe = luna.folder(f"Blader {navn.lower()}", parent=loev)
    kilder = list(enumerate(klumper)) + ([(-1, KJERNE)] if navn != "Ytre" else [])
    n_lag = 0
    for i, (c, rx, ry) in kilder:
        n_pkt = int(tetthet * (rx * s / 0.7) ** 2) + 4
        for k in range(n_pkt):
            t = 1 - 2 * (k + 0.5) / n_pkt
            a = k * 2.39996 + i * 1.7 + s * 3
            u = [math.sqrt(1 - t * t) * math.cos(a), t, math.sqrt(1 - t * t) * math.sin(a)]
            p = [c[0] + u[0] * rx * s, c[1] + u[1] * ry * s, c[2] + u[2] * rx * s]
            # Blader dypt inni en annen klump synes aldri.
            if any(j != i and inni(p, o, orx, ory) < grense for j, (o, orx, ory) in enumerate(klumper)):
                continue
            nrm = enhet([u[0] / rx, u[1] / ry, u[2] / rx])
            opp = enhet([nrm[0], nrm[1] + 0.5, nrm[2]])
            ut = enhet([p[0] - SENTER[0], -0.3, p[2] - SENTER[2]])
            frem = [ut[j] - sum(x * y for x, y in zip(ut, opp)) * opp[j] for j in range(3)]
            frem = enhet(frem if sum(x * x for x in frem) > 1e-6 else [1.0, 0.0, 0.0])
            side = enhet([opp[1] * frem[2] - opp[2] * frem[1], opp[2] * frem[0] - opp[0] * frem[2], opp[0] * frem[1] - opp[1] * frem[0]])
            vri = math.radians(rb.uniform(-60, 60))
            frem = enhet([frem[j] * math.cos(vri) + side[j] * math.sin(vri) for j in range(3)])
            if farger is YTRE:
                # Hver klump har sin egen tone (lysere/mørkere), så krona leses som tegnede løvskyer.
                farge = YTRE[max(0, min(4, int(hoyde(p[1]) * 4.5 + TONE[i] + rb.choice([-1, 0, 0, 0, 1]))))]
            else:
                farge = rb.choice(farger)
            luna.mesh(name=f"Blad {navn.lower()} {n_lag + 1}", **form(farge, rb.random() < (0.4 if s == 1 else 0.7)),
                      position=[p[j] + nrm[j] * 0.02 - frem[j] * 0.06 for j in range(3)],
                      rotation=luna.orient(forward=frem, up=opp), roughness=0.8, folder=mappe)
            n_lag += 1
    antall[navn] = n_lag

# Epler som henger utenpå bladene, med en bøyd stilk.
epler = 0
for c, rx, ry in klumper[:13]:
    rel = [c[0] - SENTER[0], c[1] - SENTER[1], c[2] - SENTER[2]]
    if rel[1] > 0.3 or epler >= 8:
        continue
    ut = enhet(rel)
    p = (c[0] + ut[0] * rx * 1.12, c[1] + ut[1] * ry * 1.12 - 0.05, c[2] + ut[2] * rx * 1.12)
    luna.sphere(name=f"Eple {epler + 1}", position=p, scale=(0.26, 0.24, 0.26), color="#e5483f", roughness=0.35, folder=tre)
    luna.curve(name=f"Eplestilk {epler + 1}",
               points=[(p[0], p[1] + 0.08, p[2]), (p[0] + 0.03, p[1] + 0.17, p[2]), (p[0] + 0.07, p[1] + 0.21, p[2])],
               radius=[0.018, 0.015, 0.012], color=BARK_MORK, folder=tre)
    epler += 1

luna.cylinder(name="Stubbe", position=(-1.15, 0.5, 0.9), scale=(0.55, 0.45, 0.55), taper=0.75, color=BARK, roughness=0.9, folder=tre)
luna.cylinder(name="Stubbe topp", position=(-1.15, 0.73, 0.9), scale=(0.42, 0.02, 0.42), color="#d9b07a", folder=tre)
luna.sphere(name="Falt eple", position=(0.95, 0.38, 0.75), scale=(0.26, 0.24, 0.26), color="#e5483f", roughness=0.35, folder=tre)
for k in range(9):
    v = random.uniform(0, math.tau)
    rad = random.uniform(0.9, 1.6)
    for s in range(3):
        luna.cone(name=f"Gress {k + 1}.{s + 1}", position=(math.cos(v) * rad + (s - 1) * 0.06, 0.4, -math.sin(v) * rad),
                  rotation=((s - 1) * 14, 0, (s - 1) * -18), scale=(0.07, 0.26, 0.07), color="#5fb84a", folder=tre)

print(f"Blader: {antall} = {sum(antall.values())}, {len(former)} bladformer, {epler} epler")
