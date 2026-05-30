// Generate custom line-icon SVGs with Gemini (replaces generic emoji).
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  generationConfig: {
    temperature: 0.4,
    responseMimeType: "application/json",
    // Disable extended thinking — it makes this large structured response hang.
    thinkingConfig: { thinkingBudget: 0 },
  },
});

const SPEC = `You are an expert minimalist icon designer (Lucide/Feather style).
Return ONLY JSON: an object mapping each key to the INNER SVG markup (paths,
circles, lines — NO <svg> wrapper) of a clean 24x24 line icon.

Constraints for EVERY icon:
- coordinates fit within viewBox 0 0 24 24, with ~2px padding
- use only <path>, <circle>, <line>, <rect>, <polyline> elements
- NO fill (the wrapper sets fill="none"); stroke is inherited (do NOT set stroke/stroke-width)
- geometric, consistent stroke weight feel, rounded, modern, legible at 18px
- distinct, recognizable silhouettes; no text

Keys and meaning:
- "bolt": a lightning bolt / spark (energy, instant)
- "hmac": a shield with a checkmark inside (verified signature)
- "idempotent": a circular refresh/loop arrow (retry-safe, no duplicates)
- "capped": a gauge / speedometer with a needle (spending limit)
- "keysplit": two distinct keys side by side (separated admin & payer keys)
- "merge": a git merge glyph (two branches merging into one)
- "seal": a document/receipt with a check or stamp (sealed receipt)

Respond with exactly: {"bolt":"...","hmac":"...","idempotent":"...","capped":"...","keysplit":"...","merge":"...","seal":"..."}`;

const res = await model.generateContent(SPEC);
const txt = res.response.text().trim();
const icons = JSON.parse(txt);
writeFileSync(new URL("./icons.json", import.meta.url), JSON.stringify(icons, null, 2));
console.log("generated icons:", Object.keys(icons).join(", "));
for (const [k, v] of Object.entries(icons)) console.log(`  ${k}: ${v.length} chars`);
