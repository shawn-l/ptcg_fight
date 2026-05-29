import cors from "cors";
import express from "express";
import WebSocket, { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { createRoomStore, serializeResolveResultForViewer } from "./rooms";
import { serializePublicState, type GameAction, type PlayerId, type ResolveResult } from "@ptcg-fight/engine";

const port = Number(process.env.PORT ?? 8787);
const app = express();
const server = createServer(app);
const rooms = createRoomStore();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/rooms", (_req, res) => {
  const room = rooms.createRoom();
  res.json({ roomId: room.id, state: serializePublicState(room.state, "p1") });
});

app.get("/rooms/:roomId", (req, res) => {
  const room = rooms.getRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "ROOM_NOT_FOUND" });
    return;
  }
  const viewer = String(req.query.viewer ?? "p1");
  res.json({ roomId: room.id, state: serializePublicState(room.state, viewer) });
});

app.post("/rooms/:roomId/actions", (req, res) => {
  const action = req.body as GameAction;
  const result = rooms.dispatch(req.params.roomId, action);
  if (!result.ok) {
    res.status(400).json(serializeResolveResultForViewer(result, action.playerId));
    return;
  }
  broadcast(req.params.roomId, result);
  res.json(serializeResolveResultForViewer(result, action.playerId));
});

const wss = new WebSocketServer({ server });
type RoomSocket = {
  socket: WebSocket;
  viewer: PlayerId;
};

const socketsByRoom = new Map<string, Set<RoomSocket>>();

wss.on("connection", (socket, request) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const roomId = url.searchParams.get("roomId") ?? "default";
  const viewer = String(url.searchParams.get("viewer") ?? "p1");
  const sockets = socketsByRoom.get(roomId) ?? new Set<RoomSocket>();
  const roomSocket = { socket, viewer };
  sockets.add(roomSocket);
  socketsByRoom.set(roomId, sockets);
  socket.onclose = () => sockets.delete(roomSocket);
});

function broadcast(roomId: string, result: ResolveResult): void {
  const sockets = socketsByRoom.get(roomId);
  if (!sockets) return;
  const payloadsByViewer = new Map<PlayerId, string>();
  for (const { socket, viewer } of sockets) {
    let payload = payloadsByViewer.get(viewer);
    if (!payload) {
      payload = JSON.stringify(serializeResolveResultForViewer(result, viewer));
      payloadsByViewer.set(viewer, payload);
    }
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

server.listen(port, "0.0.0.0", () => {
  console.log(`PTCG local server listening on http://localhost:${port}`);
});
