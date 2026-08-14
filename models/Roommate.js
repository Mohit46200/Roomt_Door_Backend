import mongoose from "mongoose";

const roommateSchema = new mongoose.Schema(
  {
    roommateId: {
      type: String,
      required: true,
      unique: true,
      enum: ["roommate-a", "roommate-b", "roommate-c"]
    },
    name: {
      type: String,
      required: true
    },
    latitude: Number,
    longitude: Number,
    accuracy: Number,
    inside: {
      type: Boolean,
      default: false
    },
    lastUpdated: Date
  },
  { timestamps: true }
);

export default mongoose.model("Roommate", roommateSchema);
