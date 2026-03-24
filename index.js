import dotenv from 'dotenv';
dotenv.config();

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import mongoose from "mongoose";

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 5000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MONGO_URI = process.env.MONGO_URI;

// ===== MongoDB =====
mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("MongoDB error:", err));

// ===== Schema =====

// Conversation
const conversationSchema = new mongoose.Schema({
  _id: String, // 🔥 THÊM DÒNG NÀY
  userId: String,
  title: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Message
const messageSchema = new mongoose.Schema({
  userId: String,
  conversationId: String,
  role: String,
  content: String,
  timestamp: {
    type: Date,
    default: Date.now
  }
});

// Index (tăng tốc)
messageSchema.index({ conversationId: 1, timestamp: 1 });

const Conversation = mongoose.model("Conversation", conversationSchema);
const Message = mongoose.model("Message", messageSchema);

// ===== Gemini =====
async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ]
    })
  });

  const data = await res.json();

  console.log("GEMINI RAW:", data); // 👈 debug

  if (!res.ok || data.error) {
    throw new Error(data.error?.message || "Gemini failed");
  }

  return data;
}
// ==========================
// 🔥 CHAT API (UPDATED)
// ==========================
app.post("/api/chat", async (req, res) => {
  const { message, conversationId, userId } = req.body;

  if (!message || !conversationId || !userId) {
    return res.status(400).json({ error: "Missing data" });
  }

  try {
    // 1. Lưu user message
    await Message.create({
      userId,
      conversationId,
      role: "user",
      content: message
    });

    // 2. Lấy history gần nhất
    const history = await Message.find({ conversationId })
      .sort({ timestamp: -1 })
      .limit(5);

    const context = history.reverse()
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    // 3. Gọi Gemini
   const data = await callGemini(context);

if (!data || data.error) {
  console.error("Gemini error:", data);
  return res.json({ reply: "❌ Gemini lỗi" });
}

   let reply = "Không có phản hồi";

if (data?.candidates?.length > 0) {
  const parts = data.candidates[0].content?.parts || [];
  reply = parts.map(p => p.text).join(" ");
}

    // 4. Lưu bot reply
    await Message.create({
      userId,
      conversationId,
      role: "assistant",
      content: reply
    });

    // 5. Update conversation title nếu chưa có
    const conv = await Conversation.findOne({ _id: conversationId });

    if (!conv) {
      await Conversation.create({
        _id: conversationId,
        userId,
        title: message.slice(0, 30)
      });
    }

    res.json({ reply });

  } catch (err) {
    console.error(err);
    res.status(500).json({ reply: "❌ Server error" });
  }
});

// ==========================
// 🔥 GET HISTORY
// ==========================
app.get("/api/history/:conversationId", async (req, res) => {
  try {
    const messages = await Message.find({
      conversationId: req.params.conversationId
    }).sort({ timestamp: 1 });

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: "Error fetching history" });
  }
});

// ==========================
// 🔥 DELETE CHAT
// ==========================
app.delete("/api/history/:conversationId", async (req, res) => {
  try {
    await Message.deleteMany({
      conversationId: req.params.conversationId
    });

    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ error: "Delete failed" });
  }
});

// ==========================
// 🔥 GET CONVERSATIONS (NEW)
// ==========================
app.get("/api/conversations/:userId", async (req, res) => {
  try {
    const list = await Conversation.find({
      userId: req.params.userId
    }).sort({ createdAt: -1 });

    res.json(list);
  } catch (err) {
    res.status(500).json({ error: "Error fetching conversations" });
  }
});

// ==========================
// 🔥 DELETE CONVERSATION
// ==========================
app.delete("/api/conversations/:id", async (req, res) => {
  try {
    await Conversation.deleteOne({ _id: req.params.id });
    await Message.deleteMany({ conversationId: req.params.id });

    res.json({ message: "Deleted conversation" });
  } catch (err) {
    res.status(500).json({ error: "Delete failed" });
  }
});

// ===== START =====
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});