import express from "express";
import { Readable } from "node:stream";

const app = express();
const PORT = process.env.PORT || 3000;
const TWEET_RE = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/status\/(\d+)/i;
const ALLOWED_MEDIA_HOST = /(^|\.)twimg\.com$/i;

app.use(express.static("public"));

// Resolve a tweet URL to its video variants.
app.get("/api/info", async (req, res) => {
  const m = TWEET_RE.exec(String(req.query.url || "").trim());
  if (!m) return res.status(400).json({ error: "Enter a valid X/Twitter post URL." });

  try {
    const r = await fetch(`https://api.fxtwitter.com/${m[1]}/status/${m[2]}`, {
      headers: { "User-Agent": "x-video-downloader/1.0" },
    });
    if (r.status === 404) return res.status(404).json({ error: "Post not found or not public." });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const { tweet } = await r.json();

    const media = (tweet.media?.all || []).filter((x) => x.type === "video" || x.type === "gif");
    if (!media.length) return res.status(404).json({ error: "This post has no video." });

    res.json({
      author: tweet.author?.name,
      handle: tweet.author?.screen_name,
      text: tweet.text,
      videos: media.map((v) => ({
        type: v.type,
        thumbnail: v.thumbnail_url,
        duration: v.duration,
        variants: (v.variants || [])
          .filter((x) => x.content_type === "video/mp4")
          .map((x) => {
            const h = /\/(\d+)x(\d+)\//.exec(x.url);
            return { url: x.url, bitrate: x.bitrate || 0, resolution: h ? `${h[1]}x${h[2]}` : null };
          })
          .sort((a, b) => b.bitrate - a.bitrate),
        fallback: v.url,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "Could not fetch the post. Try again later." });
  }
});

// Proxy the file so the browser downloads it instead of playing it.
app.get("/api/download", async (req, res) => {
  let u;
  try { u = new URL(String(req.query.url)); } catch { return res.status(400).end("Bad URL"); }
  if (u.protocol !== "https:" || !ALLOWED_MEDIA_HOST.test(u.hostname)) return res.status(400).end("Host not allowed");

  const r = await fetch(u).catch(() => null);
  if (!r?.ok) return res.status(502).end("Upstream error");

  const name = String(req.query.name || "x-video").replace(/[^\w.-]/g, "_");
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", `attachment; filename="${name}.mp4"`);
  const len = r.headers.get("content-length");
  if (len) res.setHeader("Content-Length", len);
  Readable.fromWeb(r.body).pipe(res);
});

app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
