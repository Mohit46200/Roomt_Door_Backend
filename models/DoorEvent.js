import mongoose from "mongoose";

const doorEventSchema = new mongoose.Schema(
  {
    state: {
      type: String,
      enum: ["open", "closed"],
      required: true
    },
    reason: {
      type: String,
      default: "occupancy"
    }
  },
  { timestamps: true }
);

export default mongoose.model("DoorEvent", doorEventSchema);
