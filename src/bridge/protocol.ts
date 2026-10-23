// Delt mellom appen (WebSocket-klient) og MCP-serveren (WebSocket-server).
// Holdes fri for imports slik at Node kan kjøre filen direkte.

export const BRIDGE_PORT = 47317;
/** WebSocket-lukkekode når et annet app-vindu allerede er koblet til. */
export const BRIDGE_BUSY_CODE = 4001;

export const BRIDGE_METHODS = [
  "get_scene",
  "add_objects",
  "update_objects",
  "delete_objects",
  "create_folders",
  "update_folders",
  "delete_folders",
  "select",
  "clear_scene",
  "undo",
  "redo",
  "set_view",
  "screenshot",
  "save_scene",
  "load_scene",
  "export_glb",
] as const;
export type BridgeMethod = (typeof BRIDGE_METHODS)[number];

/** MCP-server → app */
export interface BridgeRequest {
  id: string;
  method: BridgeMethod;
  params: Record<string, unknown>;
}

/** App → MCP-server */
export type BridgeResponse = { id: string; ok: true; result: unknown } | { id: string; ok: false; error: string };

export interface BridgeHello {
  type: "hello";
  app: "luna3d";
  version: string;
}
