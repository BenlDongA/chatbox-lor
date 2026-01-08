import 'dotenv/config';
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 5000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const MAX_RETRY = 3;      // số lần retry khi quá tải
const RETRY_DELAY = 1000; // ms
const MAX_HISTORY = 5;    // chỉ gửi 5 tin nhắn gần nhất để giảm token

// Hàm gọi Gemini với retry
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
    
    // Nếu quá tải, retry
    if (data.error && data.error.code === 503 && attempt < MAX_RETRY) {
      console.warn(`Gemini overloaded. Retry #${attempt} after ${RETRY_DELAY}ms`);
      await new Promise(r => setTimeout(r, RETRY_DELAY));
      return callGemini(contents, attempt + 1);
    }

    return data;

  } catch (err) {
    console.error("Error calling Gemini:", err);
    throw err;
  }
}

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: "Missing messages" });

  // chỉ lấy MAX_HISTORY tin nhắn gần nhất
  const recentMessages = messages.slice(-MAX_HISTORY);
  const contents = recentMessages.map(m => ({ parts: [{ text: m.content }] }));

  try {
    const data = await callGemini(contents);
    console.log("Gemini API response:", data);

    // Nếu Gemini trả lỗi
    if (data.error) {
      return res.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: `❌ Lỗi từ Gemini: ${data.error.message || "Unknown error"}`,
            }
          }
        ]
      });
    }

    // Lấy reply text từ candidates, join parts nếu là object
    let botReplyText = "Gemini không trả kết quả";

    if (data.candidates?.[0]?.content) {
      const contentObj = data.candidates[0].content;
      if (Array.isArray(contentObj.parts)) {
        botReplyText = contentObj.parts.map(p => p.text).join(" ");
      } else if (typeof contentObj === "string") {
        botReplyText = contentObj;
      }
    }

    res.json({
      choices: [
        {
          message: {
            role: "assistant",
            content: botReplyText
          }
        }
      ]
    });

  } catch (err) {
    res.json({
      choices: [
        {
          message: {
            role: "assistant",
            content: "❌ Lỗi server khi gọi Gemini API."
          }
        }
      ]
    });
  }
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
