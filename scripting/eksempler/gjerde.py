"""Et stakittgjerde rundt en firkant. Endre mål og avstand øverst."""
import luna3d as luna

BREDDE, DYBDE = 8.0, 6.0  # meter
AVSTAND = 0.25  # mellom stavene
HOYDE = 1.0
FARGE = "#f2efe6"

gjerde = luna.folder("Gjerde")
staver = luna.folder("Staver", parent=gjerde)


def side(x0, z0, x1, z1):
    lengde = ((x1 - x0) ** 2 + (z1 - z0) ** 2) ** 0.5
    antall = int(lengde / AVSTAND)
    for i in range(antall):
        t = i / antall
        x, z = x0 + (x1 - x0) * t, z0 + (z1 - z0) * t
        luna.box(position=(x, HOYDE / 2, z), scale=(0.07, HOYDE, 0.07), color=FARGE, folder=staver)
    # To tverrligger
    mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
    langs_x = abs(x1 - x0) > abs(z1 - z0)
    for y in (0.3, 0.75):
        luna.box(
            position=(mx, y, mz),
            scale=(lengde, 0.06, 0.03) if langs_x else (0.03, 0.06, lengde),
            color=FARGE,
            folder=gjerde,
        )


hx, hz = BREDDE / 2, DYBDE / 2
side(-hx, -hz, hx, -hz)
side(hx, -hz, hx, hz)
side(hx, hz, -hx, hz)
side(-hx, hz, -hx, -hz)
print(f"Gjerde {BREDDE} × {DYBDE} m")
