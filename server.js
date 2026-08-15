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

const ROOM_LATITUDE = Number(process.env.ROOM_LATITUDE);
const ROOM_LONGITUDE = Number(process.env.ROOM_LONGITUDE);
const ROOM_RADIUS_METERS = Number(
  process.env.ROOM_RADIUS_METERS || 25
);

// Allowed frontend origins
const allowedOrigins = [
  "http://localhost:5173",
  "https://room-door.vercel.app",
];

// -----------------------------
// Validation
// -----------------------------

if (!MONGO_URI) {
  throw new Error("MONGO_URI is missing in .env");
}

if (
  !Number.isFinite(ROOM_LATITUDE) ||
  !Number.isFinite(ROOM_LONGITUDE)
) {
  throw new Error(
    "ROOM_LATITUDE and ROOM_LONGITUDE must be valid numbers"
  );
}

// -----------------------------
// Express middleware
// -----------------------------

app.use(express.json());

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "OPTIONS"],
  })
);

// -----------------------------
// Socket.IO
// -----------------------------

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
});

// -----------------------------
// Roommates
// -----------------------------

const ROOMMATES = [
  {
    roommateId: "roommate-a",
    name: "Mohit",
  },
  {
    roommateId: "roommate-b",
    name: "Himanshu",
  },
  {
    roommateId: "roommate-c",
    name: "Harsh",
  },
];

// -----------------------------
// Seed roommates
// -----------------------------

async function seedRoommates() {
  for (const roommate of ROOMMATES) {
    await Roommate.updateOne(
      {
        roommateId: roommate.roommateId,
      },
      {
        $setOnInsert: {
          roommateId: roommate.roommateId,
          name: roommate.name,
          inside: false,
        },
      },
      {
        upsert: true,
      }
    );
  }

  console.log("Roommates seeded");
}

// -----------------------------
// Get current state
// -----------------------------

async function getCurrentState() {
  const roommates = await Roommate.find()
    .sort({ roommateId: 1 })
    .lean();

  const doorOpen = roommates.some(
    (roommate) => roommate.inside
  );

  return {
    doorStatus: doorOpen ? "open" : "closed",

    roommates,

    room: {
      latitude: ROOM_LATITUDE,
      longitude: ROOM_LONGITUDE,
      radiusMeters: ROOM_RADIUS_METERS,
    },

    updatedAt: new Date(),
  };
}

// -----------------------------
// Emit state to all clients
// -----------------------------

async function emitState() {
  const state = await getCurrentState();

  io.emit("room-state", state);

  return state;
}

// -----------------------------
// Health check
// -----------------------------

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "Backend is running",
  });
});

// -----------------------------
// Get current state
// -----------------------------

app.get("/api/state", async (req, res) => {
  try {
    const state = await getCurrentState();

    res.json(state);
  } catch (error) {
    console.error("Failed to get state:", error);

    res.status(500).json({
      message: "Failed to get current state",
    });
  }
});

// -----------------------------
// Receive location
// -----------------------------

app.post("/api/location", async (req, res) => {
  try {
    const {
      roommateId,
      latitude,
      longitude,
      accuracy,
    } = req.body;

    // Validate roommate
    if (
      !ROOMMATES.some(
        (roommate) => roommate.roommateId === roommateId
      )
    ) {
      return res.status(400).json({
        message: "Invalid roommateId",
      });
    }

    // Validate coordinates
    if (
      !Number.isFinite(Number(latitude)) ||
      !Number.isFinite(Number(longitude))
    ) {
      return res.status(400).json({
        message: "Invalid latitude/longitude",
      });
    }

    const lat = Number(latitude);
    const lon = Number(longitude);

    const acc = Number.isFinite(Number(accuracy))
      ? Number(accuracy)
      : null;

    // Calculate distance from room
    const distance = distanceInMeters(
      ROOM_LATITUDE,
      ROOM_LONGITUDE,
      lat,
      lon
    );

    // Determine whether roommate is inside
    const inside = distance <= ROOM_RADIUS_METERS;

    // Update roommate
    await Roommate.updateOne(
      {
        roommateId,
      },
      {
        $set: {
          latitude: lat,
          longitude: lon,
          accuracy: acc,
          inside,
          lastUpdated: new Date(),
        },
      }
    );

    // Save location history
    await LocationLog.create({
      roommateId,
      latitude: lat,
      longitude: lon,
      accuracy: acc,
      distanceFromRoomMeters: distance,
      inside,
    });

    // Get and broadcast updated state
    const state = await emitState();

    res.json({
      success: true,
      roommateId,
      inside,
      distanceFromRoomMeters: Math.round(distance),
      doorStatus: state.doorStatus,
    });
  } catch (error) {
    console.error("Failed to process location:", error);

    res.status(500).json({
      message: "Failed to process location",
    });
  }
});

// -----------------------------
// Reset roommates
// -----------------------------

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
          lastUpdated: null,
        },
      }
    );

    const event = await DoorEvent.create({
      state: "closed",
      reason: "manual_reset",
    });

    const state = await emitState();

    res.json({
      success: true,
      event,
      state,
    });
  } catch (error) {
    console.error("Failed to reset:", error);

    res.status(500).json({
      message: "Failed to reset",
    });
  }
});

// -----------------------------
// Socket.IO connection
// -----------------------------

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("request-state", async () => {
    try {
      const state = await getCurrentState();

      socket.emit("room-state", state);
    } catch (error) {
      console.error(
        "Failed to send state to socket:",
        error
      );
    }
  });

  socket.on("disconnect", (reason) => {
    console.log(
      "Socket disconnected:",
      socket.id,
      reason
    );
  });
});

// -----------------------------
// Start server
// -----------------------------

async function start() {
  try {
    console.log("Connecting to MongoDB...");

    await mongoose.connect(MONGO_URI);

    console.log("MongoDB connected");

    await seedRoommates();

    // Record initial door state once
    const initialState = await getCurrentState();

    const existingDoorEvent =
      await DoorEvent.findOne().sort({
        createdAt: -1,
      });

    if (!existingDoorEvent) {
      await DoorEvent.create({
        state: initialState.doorStatus,
        reason: "initial_state",
      });

      console.log("Initial door event created");
    }

    server.listen(PORT, "0.0.0.0", () => {
      console.log(
        `Backend running on port ${PORT}`
      );

      console.log(
        `Room center: ${ROOM_LATITUDE}, ${ROOM_LONGITUDE}`
      );

      console.log(
        `Room radius: ${ROOM_RADIUS_METERS}m`
      );
    });
  } catch (error) {
    console.error(
      "Failed to start server:",
      error
    );

    process.exit(1);
  }
}

start();