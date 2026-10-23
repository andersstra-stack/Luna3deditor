import type { ShapeType } from "../types";

const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

export function ShapeIcon({ type, size = 18 }: { type: ShapeType; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...s}>
      {type === "box" && (
        <>
          <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z" />
          <path d="M4 7.5 12 12l8-4.5M12 12v9" />
        </>
      )}
      {type === "sphere" && (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <ellipse cx="12" cy="12" rx="8.5" ry="3.2" />
        </>
      )}
      {type === "cylinder" && (
        <>
          <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
          <path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13" />
        </>
      )}
      {type === "cone" && (
        <>
          <path d="M12 3 5 18.5M12 3l7 15.5" />
          <ellipse cx="12" cy="18.5" rx="7" ry="2.5" />
        </>
      )}
      {type === "torus" && (
        <>
          <ellipse cx="12" cy="12" rx="9" ry="5" />
          <ellipse cx="12" cy="11.5" rx="3.5" ry="1.6" />
        </>
      )}
      {type === "plane" && <path d="M7 7h14l-4 10H3z" />}
      {type === "capsule" && <rect x="7.5" y="2.5" width="9" height="19" rx="4.5" />}
      {type === "wedge" && <path d="M4 5v14h16zM4 5l4-2v14l12 2M8 17 4 19" />}
      {type === "prism" && <path d="M3 18 9 6l12 2-6 12zM9 6l6 14M3 18l12 2" />}
      {type === "pyramid" && <path d="M12 3 3 17l9 4 9-4zM12 3v18" />}
      {type === "stairs" && <path d="M3 20h18V4h-4v4h-4v4H9v4H5v4" />}
      {type === "hemisphere" && (
        <>
          <path d="M3.5 15a8.5 8.5 0 0 1 17 0" />
          <ellipse cx="12" cy="15" rx="8.5" ry="3" />
        </>
      )}
      {type === "tube" && (
        <>
          <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
          <ellipse cx="12" cy="5.5" rx="3.5" ry="1.2" />
          <path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13" />
        </>
      )}
      {type === "roundedBox" && <rect x="4" y="4" width="16" height="16" rx="4.5" />}
      {type === "pointLight" && (
        <>
          <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
        </>
      )}
      {type === "spotLight" && <path d="M9 3h6l-1 6h-4zM10 9 5 20h14L14 9M8 14h8" />}
    </svg>
  );
}

type IconName = "move" | "rotate" | "scale" | "undo" | "redo" | "magnet" | "eye" | "eyeOff" | "trash" | "copy" | "file" | "folder" | "save" | "export" | "frame" | "folderOpen" | "folderPlus" | "chevron" | "snapObject" | "shapes" | "ground" | "mirror" | "hole";

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...s}>
      {name === "move" && <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />}
      {name === "rotate" && (
        <>
          <path d="M20 12a8 8 0 1 1-2.3-5.7" />
          <path d="M20 4v4.5h-4.5" />
        </>
      )}
      {name === "scale" && (
        <>
          <rect x="3" y="11" width="10" height="10" />
          <path d="M13 11 21 3M15 3h6v6" />
        </>
      )}
      {name === "undo" && <path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />}
      {name === "redo" && <path d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />}
      {name === "magnet" && <path d="M6 3v8a6 6 0 0 0 12 0V3h-4v8a2 2 0 0 1-4 0V3zM6 7h4M14 7h4" />}
      {name === "eye" && (
        <>
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
      {name === "eyeOff" && <path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2" />}
      {name === "trash" && <path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" />}
      {name === "copy" && (
        <>
          <rect x="8" y="8" width="13" height="13" rx="2" />
          <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
        </>
      )}
      {name === "file" && <path d="M14 3H6v18h12V7zM14 3v4h4" />}
      {name === "folder" && <path d="M3 6h6l2 2h10v11H3z" />}
      {name === "save" && <path d="M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7" />}
      {name === "export" && <path d="M12 15V3M7 8l5-5 5 5M4 15v6h16v-6" />}
      {name === "folderOpen" && <path d="M3 19V6h6l2 2h8v3M3 19l3-8h16l-3 8z" />}
      {name === "folderPlus" && <path d="M3 6h6l2 2h10v11H3zM12 11v5M9.5 13.5h5" />}
      {name === "chevron" && <path d="m9 6 6 6-6 6" />}
      {name === "snapObject" && (
        <>
          <rect x="2.5" y="8" width="9" height="9" />
          <rect x="12.5" y="8" width="9" height="9" />
          <path d="M12 4v2M12 19v2" />
        </>
      )}
      {name === "shapes" && (
        <>
          <circle cx="7" cy="7" r="3.5" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
          <path d="M7 13.5 3.5 20.5h7zM17 13.5v7M13.5 17h7" />
        </>
      )}
      {name === "ground" && <path d="M12 3v11M8 10l4 4 4-4M4 18h16M6 21h12" />}
      {name === "mirror" && <path d="M12 3v18M9 7 4 17h5zM15 7l5 10h-5z" />}
      {name === "hole" && (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="12" cy="12" r="4.5" strokeDasharray="2.5 2" />
        </>
      )}
      {name === "frame" && <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />}
    </svg>
  );
}
