import { useEffect } from "react";
import { useEditor } from "../store";
import { openStartupFile, windowLabel } from "../windows";
import { handlers } from "./commands";
import {
  BRIDGE_BUSY_CODE,
  BRIDGE_PORT,
  type BridgeHello,
  type BridgeProjectUpdate,
  type BridgeRequest,
  type BridgeResponse,
  type BridgeStatusMessage,
} from "./protocol";

const RECONNECT_MS = 2000;
const BUSY_RETRY_MS = 5000;

/**
 * Kobler vinduet til MCP-huben (som Claude Code starter). Huben eier WebSocket-porten; vinduet prøver å koble til
 * på nytt helt til det lykkes. Hvert vindu kobler til for seg selv og forteller hvilken fil det har åpen.
 */
export function useMcpBridge() {
  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: number | undefined;
    let disposed = false;
    let label = "";
    const { setBridgeStatus, setBridgeInfo } = useEditor.getState();

    const send = (msg: unknown) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
    };

    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(`ws://127.0.0.1:${BRIDGE_PORT}`);

      socket.onopen = () => {
        setBridgeStatus("connected");
        const hello: BridgeHello = { type: "hello", app: "luna3d", version: __APP_VERSION__, window: label, file: useEditor.getState().filePath };
        send(hello);
      };

      socket.onmessage = async (ev) => {
        const msg = JSON.parse(ev.data as string) as BridgeRequest | BridgeStatusMessage;
        if ("type" in msg) {
          if (msg.type === "status") setBridgeInfo({ project: msg.project, sessions: msg.sessions });
          return;
        }
        let res: BridgeResponse;
        try {
          const handler = handlers[msg.method];
          if (!handler) throw new Error(`Ukjent metode ${msg.method}`);
          res = { id: msg.id, ok: true, result: await handler(msg.params ?? {}) };
        } catch (e) {
          res = { id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) };
        }
        send(res);
      };

      socket.onclose = (ev) => {
        // Bare eldre MCP-servere (uten hub) avviser vindu nummer to.
        const busy = ev.code === BRIDGE_BUSY_CODE;
        setBridgeStatus(busy ? "busy" : "disconnected");
        if (!disposed) timer = window.setTimeout(connect, busy ? BUSY_RETRY_MS : RECONNECT_MS);
      };
      socket.onerror = () => socket?.close();
    };

    // Huben bruker filnavnet som prosjekt-id – si fra når vinduet åpner eller lagrer en annen fil.
    const unsubscribe = useEditor.subscribe((s, prev) => {
      if (s.filePath === prev.filePath) return;
      const update: BridgeProjectUpdate = { type: "project", file: s.filePath };
      send(update);
    });

    (async () => {
      label = await windowLabel();
      await openStartupFile();
      connect();
    })();

    return () => {
      disposed = true;
      unsubscribe();
      window.clearTimeout(timer);
      socket?.close();
    };
  }, []);
}
