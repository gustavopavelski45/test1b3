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

function stripCodeFences(text) {
  return String(text || "")
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
}

function tryParseJsonObject(text) {
  if (typeof text !== "string") return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function extractEmbeddedJson(text) {
  const clean = stripCodeFences(text);
  const direct = tryParseJsonObject(clean);
  if (direct) return direct;

  for (let start = 0; start < clean.length; start += 1) {
    if (clean[start] !== "{") continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < clean.length; i += 1) {
      const ch = clean[i];

      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth += 1;
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const candidate = clean.slice(start, i + 1);
          const parsed = tryParseJsonObject(candidate);
          if (parsed) return parsed;
          break;
        }
      }
    }
  }

  return null;
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
        system: typeof req.body?.system === "string" ? req.body.system : undefined,
        max_tokens: Number(req.body?.max_tokens) || 500,
        temperature: 0,
        messages: [{ role: "user", content: req.body?.prompt || "" }]
      })
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: buildErrorMessage(data, `Claude ${r.status}`), model, raw: data });
    }

    const text = extractAnthropicText(data);
    const json = extractEmbeddedJson(text);
    res.json({ text, json, model, raw: data });
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
        generationConfig: { temperature: 0 },
        contents: [{ parts: [{ text: req.body?.prompt || "" }] }]
      })
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: buildErrorMessage(data, `Gemini ${r.status}`), raw: data });
    }

    const text = extractGeminiText(data);
    const json = extractEmbeddedJson(text);
    res.json({ text, json, raw: data });
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
        temperature: 0,
        messages: [{ role: "user", content: req.body?.prompt || "" }]
      })
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: buildErrorMessage(data, `DeepSeek ${r.status}`), raw: data });
    }

    const text = extractDeepSeekText(data);
    const json = extractEmbeddedJson(text);
    res.json({ text, json, raw: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("rodando " + PORT));
