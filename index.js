import 'dotenv/config';
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

// ===== MongoDB connect =====
mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("MongoDB error:", err));

// ===== Schema =====
const messageSchema = new mongoose.Schema({
  conversationId: String,
  role: String, // 'user' | 'assistant'
  content: String,
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const Message = mongoose.model("Message", messageSchema);

// ===== Config =====
const MAX_RETRY = 3;
const RETRY_DELAY = 1000;
const MAX_HISTORY = 5;

// ===== Call Gemini =====
async function callGemini(contents, attempt = 1) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY 
      },
      body: JSON.stringify({ contents }),
    });

    const data = await res.json();

    if (data.error && data.error.code === 503 && attempt < MAX_RETRY) {
      console.warn(`⚠️ Gemini overloaded. Retry #${attempt}`);
      await new Promise(r => setTimeout(r, RETRY_DELAY));
      return callGemini(contents, attempt + 1);
    }

    return data;

  } catch (err) {
    console.error("❌ Error calling Gemini:", err);
    throw err;
  }
}

// ===== CHAT API =====
app.post("/api/chat", async (req, res) => {
  const { message, conversationId } = req.body;

  if (!message || !conversationId) {
    return res.status(400).json({ error: "Missing message or conversationId" });
  }

  try {
    // 1. Lưu message user
    await Message.create({
      conversationId,
      role: "user",
      content: message
    });

    // 2. Lấy history
    const history = await Message.find({ conversationId })
      .sort({ timestamp: 1 });

    // 3. Giới hạn context
    const recentMessages = history.slice(-MAX_HISTORY);

    const contents = recentMessages.map(m => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }]
    }));

    // 4. Gọi Gemini
    const data = await callGemini(contents);

    if (data.error) {
      return res.json({
        reply: `❌ Gemini error: ${data.error.message}`
      });
    }

    // 5. Lấy reply
    let botReplyText = "Gemini không trả kết quả";

    if (data.candidates?.[0]?.content?.parts) {
      botReplyText = data.candidates[0].content.parts
        .map(p => p.text)
        .join(" ");
    }

    // 6. Lưu bot reply
    await Message.create({
      conversationId,
      role: "assistant",
      content: botReplyText
    });

    // 7. Trả về
    res.json({ reply: botReplyText });

  } catch (err) {
    console.error(err);
    res.json({ reply: "❌ Lỗi server" });
  }
});

// ===== GET HISTORY =====
app.get("/api/history/:conversationId", async (req, res) => {
  try {
    const { conversationId } = req.params;

    const messages = await Message.find({ conversationId })
      .sort({ timestamp: 1 });

    res.json(messages);

  } catch (err) {
    res.status(500).json({ error: "Error fetching history" });
  }
});

// ===== DELETE CHAT =====
app.delete("/api/history/:conversationId", async (req, res) => {
  try {
    const { conversationId } = req.params;

    await Message.deleteMany({ conversationId });

    res.json({ message: "Deleted conversation" });

  } catch (err) {
    res.status(500).json({ error: "Delete failed" });
  }
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});