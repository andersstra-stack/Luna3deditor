"""
luna3d – bygg og endre Luna 3D-scener fra Python.

    import luna3d as luna

    gjerde = luna.folder("Gjerde")
    for i in range(20):
        luna.box(position=(i * 0.5, 0.5, 0), scale=(0.08, 1, 0.08), color="#8b5a2b", folder=gjerde)
    luna.box(position=(4.75, 0.85, 0), scale=(10, 0.08, 0.04), color="#8b5a2b", folder=gjerde)

Mål er i meter, Y er opp og bakken er y = 0. Rotasjon er i grader (XYZ).
Alle former er enhetsstore og sentrert, så `scale` er størrelsen i meter.
Uten `position` står formen på bakken i origo.

Skriptet kjøres med `python -m luna3d skript.py` (gjøres av Luna 3D / MCP-verktøyet
run_python). Endringene sendes til appen først når skriptet er ferdig uten feil, og
hele kjøringen er ett angre-steg. `print()` vises som skriptets utdata.

Former: box, sphere, cylinder, cone, torus, plane, capsule, wedge, prism, pyramid,
stairs, hemisphere, tube, rounded_box, curve, point_light, spot_light (eller add(type, ...)).

Organiske former: cylinder(taper=0.6) smalner av mot toppen (toppens diameter i forhold til bunnens).
curve(points=[...], radius=...) er et rør langs en jevn kurve gjennom punktene (i verdensrommet) –
greiner, røtter, kabler. radius er ett tall eller ett per punkt:

    luna.curve(points=[(0, 1.6, 0), (0.6, 2.1, 0.1), (1.1, 2.3, 0)], radius=[0.12, 0.07, 0.03], color="#8a5a3b")

Egne former: mesh(vertices=[(x, y, z), ...], triangles=[(a, b, c), ...]) – hjørnene i formens eget
koordinatsystem (meter); position er der origo havner og rotation dreier rundt det. Trekantene går mot
klokka sett utenfra. Like former deles, så samme blad 400 ganger lagres én gang. smooth=True gir myke
overganger, vertex_colors=[...] farge per hjørne. orient(forward, up) gir rotasjonen som peker formens
+Z langs forward og +Y mot up:

    blad = dict(vertices=[(0, 0, 0), (0.06, 0, 0.15), (0, 0.01, 0.3), (-0.06, 0, 0.15)], triangles=[(0, 2, 1), (0, 3, 2)])
    luna.mesh(**blad, position=(1, 2, 0), rotation=luna.orient(forward=(1, 0.3, 0), up=(0, 1, 0)), color="#5fb84a")

Markør-noder (node) er usynlige punkter med navn og retning som spillmotoren leser: lokal +Z er
forover og +Y opp. Egendefinerte egenskaper legges i props={...} (eksporteres som glTF extras):

    luna.node(name="hp_turret_S_01", position=(0, 2.1, 4), props={"yaw_min": -150, "yaw_max": 150})
"""

import json
import math
import os
import sys

__all__ = [
    "scene", "objects", "get", "folders", "folder", "add", "update", "delete",
    "box", "sphere", "cylinder", "cone", "torus", "plane", "capsule", "wedge", "prism",
    "pyramid", "stairs", "hemisphere", "tube", "rounded_box", "curve", "point_light", "spot_light", "node", "mesh",
    "orient",
]

SHAPES = {
    "box", "sphere", "cylinder", "cone", "torus", "plane", "capsule", "wedge", "prism",
    "pyramid", "stairs", "hemisphere", "tube", "roundedBox", "curve", "pointLight", "spotLight", "node", "mesh",
}
PROPS = {
    "name", "position", "rotation", "scale", "color", "metalness", "roughness",
    "opacity", "visible", "hole", "intensity", "emissive", "material", "props", "folder",
    "taper", "points", "radius", "vertices", "triangles", "vertex_colors", "smooth",
}
MARKER = "@@LUNA3D_OPS@@"
MAX_OPS = 20000


def _load_scene():
    path = os.environ.get("LUNA3D_SCENE_FILE")
    if path and os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return {"objects": [], "folders": []}


#: Scenen slik den var da skriptet startet: {"objects": [...], "folders": [...]}.
#: Hvert objekt har også "bounds" ({"min": [x,y,z], "max": [x,y,z]}) i verdensrom.
scene = _load_scene()

_ops = []
_counter = 0


def _key(prefix):
    global _counter
    _counter += 1
    return f"@{prefix}{_counter}"


def _push(op):
    if len(_ops) >= MAX_OPS:
        raise RuntimeError(f"For mange endringer (maks {MAX_OPS})")
    _ops.append(op)


def _vec3(name, value):
    try:
        v = [float(x) for x in value]
    except TypeError:
        raise ValueError(f"{name} må være tre tall, f.eks. (1, 2, 3) – fikk {value!r}") from None
    if len(v) != 3 or not all(math.isfinite(x) for x in v):
        raise ValueError(f"{name} må være tre endelige tall – fikk {value!r}")
    return v


def _clean(props):
    unknown = set(props) - PROPS
    if unknown:
        raise ValueError(f"Ukjente egenskaper: {', '.join(sorted(unknown))}. Gyldige: {', '.join(sorted(PROPS))}")
    out = {}
    for k, v in props.items():
        if v is None and k != "folder":
            continue
        if k in ("position", "rotation", "scale"):
            v = _vec3(k, v)
        elif k == "props":
            if not isinstance(v, dict):
                raise ValueError(f"props må være en dict, f.eks. {{'type': 'pirate_grunt'}} – fikk {v!r}")
            for pk, pv in v.items():
                # Unity leser bare tall og tekst – bruk 1/0 i stedet for True/False.
                if not isinstance(pk, str) or isinstance(pv, bool) or not isinstance(pv, (str, int, float)):
                    raise ValueError(f"props må ha tekstnøkler og tall eller tekst som verdier (1/0 for ja/nei) – fikk {pk!r}: {pv!r}")
            v = dict(v)
        elif k == "points":
            try:
                v = [_vec3(f"points[{i}]", p) for i, p in enumerate(v)]
            except TypeError:
                raise ValueError(f"points må være en liste med punkter (x, y, z) – fikk {v!r}") from None
            if len(v) < 2:
                raise ValueError("points må ha minst to punkter")
        elif k == "radius":
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                v = float(v)
            else:
                try:
                    v = [float(r) for r in v]
                except (TypeError, ValueError):
                    raise ValueError(f"radius må være et tall eller én radius per punkt – fikk {v!r}") from None
        elif k == "vertices":
            try:
                v = [_vec3(f"vertices[{i}]", p) for i, p in enumerate(v)]
            except TypeError:
                raise ValueError(f"vertices må være en liste med hjørner (x, y, z) – fikk {v!r}") from None
        elif k == "triangles":
            try:
                v = [[int(i) for i in t] for t in v]
            except (TypeError, ValueError):
                raise ValueError(f"triangles må være en liste med trekanter (a, b, c) – fikk {v!r}") from None
            if not all(len(t) == 3 for t in v):
                raise ValueError("hver trekant må ha tre hjørnenumre")
        elif k == "vertex_colors":
            v = list(v)
            if not all(isinstance(c, str) and len(c) == 7 and c.startswith("#") for c in v):
                raise ValueError("vertex_colors må være hex-farger som '#ff8800', én per hjørne")
        elif k == "smooth":
            v = bool(v)
        elif k == "taper":
            v = float(v)
            if not 0 <= v <= 1:
                raise ValueError(f"taper må være mellom 0 (spiss) og 1 (rett sylinder) – fikk {v!r}")
        elif k == "color":
            if not (isinstance(v, str) and len(v) == 7 and v.startswith("#")):
                raise ValueError(f"color må være en hex-farge som '#ff8800' – fikk {v!r}")
        out[k] = v
    return out


# ---------- Lese scenen ----------

def objects(name=None, type=None, folder=None):
    """Objekter i scenen (da skriptet startet), filtrert på navn (delstreng), type og/eller mappe-id."""
    result = scene["objects"]
    if name is not None:
        result = [o for o in result if name.lower() in o["name"].lower()]
    if type is not None:
        result = [o for o in result if o["type"] == type]
    if folder is not None:
        result = [o for o in result if o.get("folderId") == folder]
    return result


def get(id):
    """Ett objekt eller én mappe fra scenen, etter id."""
    for item in scene["objects"] + scene["folders"]:
        if item["id"] == id:
            return item
    raise KeyError(f"Fant ikke {id}")


def folders(name=None):
    """Mapper i scenen, eventuelt filtrert på navn (delstreng)."""
    result = scene["folders"]
    if name is not None:
        result = [f for f in result if name.lower() in f["name"].lower()]
    return result


# ---------- Endre scenen ----------

def folder(name, parent=None, model=None):
    """Lager en mappe og returnerer en nøkkel som kan brukes som folder=/parent=.

    model=True: mappa eksporteres som ÉN modell (én mesh med ett palett-materiale) – f.eks. et tre eller et hus.
    Deler som skal bevege seg i spillet (dør, hjul) legges i egne undermapper med model=True og en node «pivot».
    """
    key = _key("f")
    op = {"op": "folder", "key": key, "name": str(name), "parent": parent}
    if model is not None:
        op["model"] = bool(model)
    _push(op)
    return key


def add(type, **props):
    """Legger til en form eller et lys. Returnerer en nøkkel som kan brukes i update()/delete()."""
    if type not in SHAPES:
        raise ValueError(f"Ukjent type {type!r}. Gyldige: {', '.join(sorted(SHAPES))}")
    key = _key("o")
    _push({"op": "add", "key": key, "type": type, "props": _clean(props)})
    return key


def update(id, **props):
    """Endrer et eksisterende objekt (id fra scenen) eller et objekt laget tidligere i skriptet."""
    _push({"op": "update", "id": id, "props": _clean(props)})


def delete(*ids):
    """Sletter objekter (id-er fra scenen eller nøkler fra dette skriptet)."""
    flat = [i for item in ids for i in (item if isinstance(item, (list, tuple)) else [item])]
    if flat:
        _push({"op": "delete", "ids": flat})


def _shape(type):
    def make(**props):
        return add(type, **props)

    make.__name__ = type
    make.__doc__ = f"Legger til {type}. Samme egenskaper som add()."
    return make


box = _shape("box")
sphere = _shape("sphere")
cylinder = _shape("cylinder")
cone = _shape("cone")
torus = _shape("torus")
plane = _shape("plane")
capsule = _shape("capsule")
wedge = _shape("wedge")
prism = _shape("prism")
pyramid = _shape("pyramid")
stairs = _shape("stairs")
hemisphere = _shape("hemisphere")
tube = _shape("tube")
rounded_box = _shape("roundedBox")
curve = _shape("curve")
mesh = _shape("mesh")


def orient(forward, up=(0, 1, 0)):
    """Rotasjonen (Euler XYZ i grader) som peker formens +Z langs forward og +Y så nær up som mulig.

    Samme akser som markør-noder: +Z forover, +Y opp. Nyttig for blader, piler, greiner og alt som skal
    peke en bestemt vei: luna.mesh(..., rotation=luna.orient(forward=retning, up=normal)).
    """
    def norm(v):
        l = math.sqrt(sum(c * c for c in v))
        if l < 1e-12:
            raise ValueError(f"Retningen {v!r} har lengde 0")
        return [c / l for c in v]

    def cross(a, b):
        return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

    z = norm(_vec3("forward", forward))
    x = cross(_vec3("up", up), z)
    if math.sqrt(sum(c * c for c in x)) < 1e-9:
        # up er parallell med forward: velg en annen hjelpeakse.
        x = cross([1, 0, 0] if abs(z[0]) < 0.9 else [0, 0, 1], z)
    x = norm(x)
    y = cross(z, x)
    # Matrisen med kolonnene x, y, z -> Euler XYZ (som three.js).
    m13, m23, m33, m12, m11 = z[0], z[1], z[2], y[0], x[0]
    ry = math.asin(max(-1.0, min(1.0, m13)))
    if abs(m13) < 0.9999999:
        rx, rz = math.atan2(-m23, m33), math.atan2(-m12, m11)
    else:
        rx, rz = math.atan2(y[2], y[1]), 0.0
    return (math.degrees(rx), math.degrees(ry), math.degrees(rz))
point_light = _shape("pointLight")
spot_light = _shape("spotLight")
node = _shape("node")


def _emit():
    sys.stdout.write("\n" + MARKER + json.dumps({"format": "luna3d/script-ops", "version": 1, "ops": _ops}) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    # `python -m luna3d skript.py`: kjør skriptet, og send endringene bare hvis det gikk bra.
    # Skriptet importerer `luna3d` som egen modul (ikke __main__), så endringene samles der.
    import runpy

    if len(sys.argv) < 2:
        sys.exit("Bruk: python -m luna3d skript.py")
    import luna3d as _api

    script = sys.argv[1]
    sys.argv = sys.argv[1:]
    runpy.run_path(script, run_name="__main__")
    _api._emit()
