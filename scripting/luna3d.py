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
stairs, hemisphere, tube, rounded_box, point_light, spot_light (eller add(type, ...)).
"""

import json
import math
import os
import sys

__all__ = [
    "scene", "objects", "get", "folders", "folder", "add", "update", "delete",
    "box", "sphere", "cylinder", "cone", "torus", "plane", "capsule", "wedge", "prism",
    "pyramid", "stairs", "hemisphere", "tube", "rounded_box", "point_light", "spot_light",
]

SHAPES = {
    "box", "sphere", "cylinder", "cone", "torus", "plane", "capsule", "wedge", "prism",
    "pyramid", "stairs", "hemisphere", "tube", "roundedBox", "pointLight", "spotLight",
}
PROPS = {
    "name", "position", "rotation", "scale", "color", "metalness", "roughness",
    "opacity", "visible", "hole", "intensity", "folder",
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

def folder(name, parent=None):
    """Lager en mappe og returnerer en nøkkel som kan brukes som folder=/parent=."""
    key = _key("f")
    _push({"op": "folder", "key": key, "name": str(name), "parent": parent})
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
point_light = _shape("pointLight")
spot_light = _shape("spotLight")


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
