const path = require("path");
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const DEFAULT_CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";

function pickApiKey(bodyKey, envKey) {
  return (bodyKey || envKey || "").trim();
}

function extractAnthropicText(data) {
  if (typeof data?.text === "string") return data.text;
  if (Array.isArray(data?.content)) {
    return data.content
      .filter((item) => item?.type === "text" && typeof item?.text === "string")
      .map((item) => item.text)
      .join("\n")
      .trim();
  }
  return "";
}

function extractGeminiText(data) {
  return (
    data?.text ||
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => part?.text || "")
      .join("\n")
      .trim() ||
    ""
  );
}

function extractDeepSeekText(data) {
  return data?.text || data?.choices?.[0]?.message?.content || "";
}

function buildErrorMessage(data, fallback) {
  return (
    data?.error?.message ||
    data?.error ||
    data?.message ||
    fallback
  );
}

app.post("/api/claude", async (req, res) => {
  try {
    const apiKey = pickApiKey(req.body?.apiKey, process.env.CLAUDE_API_KEY);
    const model = (req.body?.model || DEFAULT_CLAUDE_MODEL || "").trim();
    if (!apiKey) {
      return res.status(400).json({ error: "CLAUDE_API_KEY ausente." });
    }
    if (!model) {
      return res.status(400).json({ error: "Modelo Claude ausente." });
    }

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: Number(req.body?.max_tokens) || 500,
        messages: [{ role: "user", content: req.body?.prompt || "" }]
      })
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: buildErrorMessage(data, `Claude ${r.status}`), model, raw: data });
    }

    res.json({ text: extractAnthropicText(data), model, raw: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/gemini", async (req, res) => {
  try {
    const apiKey = pickApiKey(req.body?.apiKey, process.env.GEMINI_API_KEY);
    if (!apiKey) {
      return res.status(400).json({ error: "GEMINI_API_KEY ausente." });
    }

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: req.body?.prompt || "" }] }]
      })
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: buildErrorMessage(data, `Gemini ${r.status}`), raw: data });
    }

    res.json({ text: extractGeminiText(data), raw: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/deepseek", async (req, res) => {
  try {
    const apiKey = pickApiKey(req.body?.apiKey, process.env.DEEPSEEK_API_KEY);
    if (!apiKey) {
      return res.status(400).json({ error: "DEEPSEEK_API_KEY ausente." });
    }

    const r = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: req.body?.prompt || "" }]
      })
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: buildErrorMessage(data, `DeepSeek ${r.status}`), raw: data });
    }

    res.json({ text: extractDeepSeekText(data), raw: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("rodando " + PORT));
