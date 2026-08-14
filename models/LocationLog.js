import mongoose from "mongoose";

const locationLogSchema = new mongoose.Schema(
  {
    roommateId: {
      type: String,
      required: true,
      enum: ["roommate-a", "roommate-b", "roommate-c"]
    },
    latitude: Number,
    longitude: Number,
    accuracy: Number,
    distanceFromRoomMeters: Number,
    inside: Boolean
  },
  { timestamps: true }
);

export default mongoose.model("LocationLog", locationLogSchema);
