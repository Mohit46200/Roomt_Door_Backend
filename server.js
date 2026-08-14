import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import mongoose from "mongoose";
import { Server } from "socket.io";

import Roommate from "./models/Roommate.js";
import LocationLog from "./models/LocationLog.js";
import DoorEvent from "./models/DoorEvent.js";
import { distanceInMeters } from "./utils/distance.js";

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT || 5000);
const MONGO_URI = process.env.MONGO_URI;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const ROOM_LATITUDE = Number(process.env.ROOM_LATITUDE);
const ROOM_LONGITUDE = Number(process.env.ROOM_LONGITUDE);
const ROOM_RADIUS_METERS = Number(process.env.ROOM_RADIUS_METERS || 25);

if (!MONGO_URI) {
  throw new Error("MONGO_URI is missing in .env");
}

if (!Number.isFinite(ROOM_LATITUDE) || !Number.isFinite(ROOM_LONGITUDE)) {
  throw new Error("ROOM_LATITUDE and ROOM_LONGITUDE must be valid numbers");
}

app.use(
  cors({
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"]
  })
);
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"]
  }
});

const ROOMMATES = [
  { roommateId: "roommate-a", name: "Roommate A" },
  { roommateId: "roommate-b", name: "Roommate B" },
  { roommateId: "roommate-c", name: "Roommate C" }
];

async function seedRoommates() {
  for (const roommate of ROOMMATES) {
    await Roommate.updateOne(
      { roommateId: roommate.roommateId },
      {
        $setOnInsert: {
          roommateId: roommate.roommateId,
          name: roommate.name,
          inside: false
        }
      },
      { upsert: true }
    );
  }
}

async function getCurrentState() {
  const roommates = await Roommate.find()
    .sort({ roommateId: 1 })
    .lean();

  const doorOpen = roommates.some((roommate) => roommate.inside);

  return {
    doorStatus: doorOpen ? "open" : "closed",
    roommates,
    room: {
      latitude: ROOM_LATITUDE,
      longitude: ROOM_LONGITUDE,
      radiusMeters: ROOM_RADIUS_METERS
    },
    updatedAt: new Date()
  };
}

async function emitState() {
  const state = await getCurrentState();
  io.emit("room-state", state);
  return state;
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/state", async (req, res) => {
  try {
    res.json(await getCurrentState());
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to get current state" });
  }
});

app.post("/api/location", async (req, res) => {
  try {
    const { roommateId, latitude, longitude, accuracy } = req.body;

    if (!ROOMMATES.some((r) => r.roommateId === roommateId)) {
      return res.status(400).json({ message: "Invalid roommateId" });
    }

    if (
      !Number.isFinite(Number(latitude)) ||
      !Number.isFinite(Number(longitude))
    ) {
      return res.status(400).json({ message: "Invalid latitude/longitude" });
    }

    const lat = Number(latitude);
    const lon = Number(longitude);
    const acc = Number.isFinite(Number(accuracy)) ? Number(accuracy) : null;

    const distance = distanceInMeters(
      ROOM_LATITUDE,
      ROOM_LONGITUDE,
      lat,
      lon
    );

    const inside = distance <= ROOM_RADIUS_METERS;

    await Roommate.updateOne(
      { roommateId },
      {
        $set: {
          latitude: lat,
          longitude: lon,
          accuracy: acc,
          inside,
          lastUpdated: new Date()
        }
      }
    );

    await LocationLog.create({
      roommateId,
      latitude: lat,
      longitude: lon,
      accuracy: acc,
      distanceFromRoomMeters: distance,
      inside
    });

    const state = await emitState();

    res.json({
      success: true,
      roommateId,
      inside,
      distanceFromRoomMeters: Math.round(distance),
      doorStatus: state.doorStatus
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to process location" });
  }
});

app.post("/api/roommates/reset", async (req, res) => {
  try {
    await Roommate.updateMany(
      {},
      {
        $set: {
          inside: false,
          latitude: null,
          longitude: null,
          accuracy: null,
          lastUpdated: null
        }
      }
    );

    const event = await DoorEvent.create({
      state: "closed",
      reason: "manual_reset"
    });

    const state = await emitState();

    res.json({ success: true, event, state });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to reset" });
  }
});

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("request-state", async () => {
    try {
      socket.emit("room-state", await getCurrentState());
    } catch (error) {
      console.error(error);
    }
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

async function start() {
  await mongoose.connect(MONGO_URI);
  await seedRoommates();

  // Record the initial state once.
  const initialState = await getCurrentState();
  const existingDoorEvent = await DoorEvent.findOne().sort({ createdAt: -1 });
  if (!existingDoorEvent) {
    await DoorEvent.create({
      state: initialState.doorStatus,
      reason: "initial_state"
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Backend running on http://localhost:${PORT}`);
    console.log(
      `Room center: ${ROOM_LATITUDE}, ${ROOM_LONGITUDE} | radius: ${ROOM_RADIUS_METERS}m`
    );
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
