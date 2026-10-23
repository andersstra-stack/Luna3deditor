import { useEffect } from "react";
import { useEditor } from "../store";
import { handlers } from "./commands";
import { BRIDGE_BUSY_CODE, BRIDGE_PORT, type BridgeHello, type BridgeRequest, type BridgeResponse } from "./protocol";

const RECONNECT_MS = 2000;
const BUSY_RETRY_MS = 5000;

/**
 * Kobler appen til MCP-serveren (som Claude Code starter). Serveren eier
 * WebSocket-porten; appen prøver å koble til på nytt helt til den lykkes.
 */
export function useMcpBridge() {
  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: number | undefined;
    let disposed = false;
    const { setBridgeStatus } = useEditor.getState();

    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(`ws://127.0.0.1:${BRIDGE_PORT}`);

      socket.onopen = () => {
        setBridgeStatus("connected");
        const hello: BridgeHello = { type: "hello", app: "luna3d", version: __APP_VERSION__ };
        socket?.send(JSON.stringify(hello));
      };

      socket.onmessage = async (ev) => {
        const req = JSON.parse(ev.data as string) as BridgeRequest;
        let res: BridgeResponse;
        try {
          const handler = handlers[req.method];
          if (!handler) throw new Error(`Ukjent metode ${req.method}`);
          res = { id: req.id, ok: true, result: await handler(req.params ?? {}) };
        } catch (e) {
          res = { id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) };
        }
        socket?.send(JSON.stringify(res));
      };

      socket.onclose = (ev) => {
        const busy = ev.code === BRIDGE_BUSY_CODE;
        setBridgeStatus(busy ? "busy" : "disconnected");
        if (!disposed) timer = window.setTimeout(connect, busy ? BUSY_RETRY_MS : RECONNECT_MS);
      };
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      socket?.close();
    };
  }, []);
}
