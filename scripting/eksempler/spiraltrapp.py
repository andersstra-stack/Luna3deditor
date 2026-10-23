"""En spiraltrapp rundt en søyle. Endre antall trinn, høyde og radius øverst."""
import math

import luna3d as luna

TRINN = 24
HOYDE = 4.0  # meter totalt
RADIUS = 1.4  # ytre radius
OMDREININGER = 1.25

trapp = luna.folder("Spiraltrapp")
luna.cylinder(name="Søyle", position=(0, HOYDE / 2, 0), scale=(0.3, HOYDE, 0.3), color="#8a8f98", folder=trapp)

stigning = HOYDE / TRINN
for i in range(TRINN):
    vinkel = i / TRINN * OMDREININGER * 360
    rad = math.radians(vinkel)
    # Trinnet peker utover fra søylen; midten ligger halvveis ut.
    x, z = math.cos(rad) * RADIUS / 2, -math.sin(rad) * RADIUS / 2
    luna.box(
        name=f"Trinn {i + 1}",
        position=(x, stigning * (i + 0.5), z),
        rotation=(0, vinkel, 0),
        scale=(RADIUS, 0.06, 0.35),
        color="#b07a48",
        folder=trapp,
    )

print(f"{TRINN} trinn, {HOYDE} m høy")
