// Egendefinerte egenskaper (Custom Properties fra Blender) på modellene i en binær FBX-fil.
// three sin FBXLoader tar ikke med dem, så her leses fila direkte – bare det som trengs:
// Objects → Model → Properties70 → P-er merket «U» (brukerdefinert). Modell-id-en er den
// samme som FBXLoader legger på objektet (`object.ID`), så egenskapene kan kobles til nodene.

import type { NodeProps } from "./types";

const MAGIC = "Kaydara FBX Binary  ";

interface FbxNode {
  name: string;
  props: unknown[];
  children: FbxNode[];
}

/**
 * Brukerdefinerte egenskaper per modell, etter id og etter navn (id-ene er 64-biters og kan miste
 * presisjon som JS-tall, så navnet er reserven). Tomt for ASCII-FBX og filer uten egenskaper.
 */
export function fbxUserProps(buffer: ArrayBuffer): { byId: Map<number, NodeProps>; byName: Map<string, NodeProps> } {
  const byId = new Map<number, NodeProps>();
  const byName = new Map<string, NodeProps>();
  const result = { byId, byName };
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 27 || new TextDecoder().decode(bytes.subarray(0, 20)) !== MAGIC) return result;

  const view = new DataView(buffer);
  const wide = view.getUint32(23, true) >= 7500; // fra FBX 7.5 er postene 64-biters
  const text = new TextDecoder();
  let at = 27;

  const u32 = () => {
    const v = view.getUint32(at, true);
    at += 4;
    return v;
  };
  const offset = () => {
    const v = wide ? Number(view.getBigUint64(at, true)) : view.getUint32(at, true);
    at += wide ? 8 : 4;
    return v;
  };

  const readProp = (): unknown => {
    const type = String.fromCharCode(bytes[at++]);
    let v: unknown;
    switch (type) {
      case "Y": v = view.getInt16(at, true); at += 2; break;
      case "C": v = bytes[at] !== 0; at += 1; break;
      case "I": v = view.getInt32(at, true); at += 4; break;
      case "F": v = view.getFloat32(at, true); at += 4; break;
      case "D": v = view.getFloat64(at, true); at += 8; break;
      case "L": v = Number(view.getBigInt64(at, true)); at += 8; break;
      case "S":
      case "R": {
        const len = u32();
        v = type === "S" ? text.decode(bytes.subarray(at, at + len)) : null;
        at += len;
        break;
      }
      case "f": case "d": case "l": case "i": case "b": {
        // Tabeller (geometri o.l.) hoppes over uten å pakkes ut.
        u32(); // antall
        u32(); // koding
        const len = u32(); // (ikke `at += u32()` – da leses `at` før u32() flytter den)
        at += len;
        v = null;
        break;
      }
      default:
        throw new Error(`Ukjent FBX-egenskapstype «${type}»`);
    }
    return v;
  };

  /** Én post med barn; null ved slutt-posten (bare nuller). */
  const readNode = (): FbxNode | null => {
    const end = offset();
    const count = offset();
    offset(); // lengden på egenskapslista
    const nameLen = bytes[at++];
    if (end === 0) return null;
    const name = text.decode(bytes.subarray(at, at + nameLen));
    at += nameLen;
    const props: unknown[] = [];
    for (let i = 0; i < count; i++) props.push(readProp());
    const children: FbxNode[] = [];
    while (at < end) {
      const child = readNode();
      if (!child) break;
      children.push(child);
    }
    at = end;
    return { name, props, children };
  };

  try {
    while (at < bytes.length - 13) {
      const node = readNode();
      if (!node) break;
      if (node.name !== "Objects") continue;
      for (const model of node.children) {
        if (model.name !== "Model" || typeof model.props[0] !== "number") continue;
        const p70 = model.children.find((c) => c.name === "Properties70");
        const props: NodeProps = {};
        for (const p of p70?.children ?? []) {
          const [key, , , flags, value] = p.props;
          if (p.name !== "P" || typeof key !== "string" || typeof flags !== "string" || !flags.includes("U")) continue;
          // Unity leser bare tall og tekst: sannhetsverdier blir 1/0, vektorer o.l. hoppes over.
          if (typeof value === "number" || typeof value === "string") props[key] = value;
          else if (typeof value === "boolean") props[key] = value ? 1 : 0;
        }
        if (!Object.keys(props).length) continue;
        byId.set(model.props[0], props);
        // Navnet er lagret som «navn\x00\x01Model».
        if (typeof model.props[1] === "string") byName.set(model.props[1].split("\x00")[0], props);
      }
      break;
    }
  } catch (e) {
    console.warn("Kunne ikke lese egenskapene i FBX-fila", e);
  }
  return result;
}
