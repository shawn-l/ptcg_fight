import cors from "cors";
import express from "express";
import WebSocket, { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { createRoomStore } from "./rooms";
import { serializePublicState, type GameAction } from "@ptcg-fight/engine";

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
    res.status(400).json(result);
    return;
  }
  broadcast(req.params.roomId, result);
  res.json(result);
});

const wss = new WebSocketServer({ server });
const socketsByRoom = new Map<string, Set<WebSocket>>();

wss.on("connection", (socket, request) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const roomId = url.searchParams.get("roomId") ?? "default";
  const sockets = socketsByRoom.get(roomId) ?? new Set<WebSocket>();
  sockets.add(socket);
  socketsByRoom.set(roomId, sockets);
  socket.onclose = () => sockets.delete(socket);
});

function broadcast(roomId: string, message: unknown): void {
  const sockets = socketsByRoom.get(roomId);
  if (!sockets) return;
  const payload = JSON.stringify(message);
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

server.listen(port, "0.0.0.0", () => {
  console.log(`PTCG local server listening on http://localhost:${port}`);
});
