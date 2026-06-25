const express = require("express");
const puppeteer = require("puppeteer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.static(__dirname));

const previewsDir = path.join(__dirname, "previews");
if (!fs.existsSync(previewsDir)) fs.mkdirSync(previewsDir);

app.get("/", (req, res) => {
  res.send("Tipografika is running 🚀");
});

function cleanPreviews() {
  if (!fs.existsSync(previewsDir)) return;
  fs.readdirSync(previewsDir).forEach(file => {
    fs.unlinkSync(path.join(previewsDir, file));
  });
}

async function acceptCookies(page) {
  const texts = [
    "Accept all", "Accept All", "Accept", "I agree", "Agree", "Allow all",
    "OK", "Got it", "Piekrītu", "Piekrist", "Apstiprināt", "Akceptēt", "Labi"
  ];

  for (const text of texts) {
    try {
      const clicked = await page.evaluate((text) => {
        const buttons = Array.from(document.querySelectorAll("button, a, input[type='button'], input[type='submit']"));
        const btn = buttons.find(el => {
          const value = (el.innerText || el.value || "").trim().toLowerCase();
          return value.includes(text.toLowerCase());
        });

        if (btn) {
          btn.click();
          return true;
        }

        return false;
      }, text);

      if (clicked) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return true;
      }
    } catch (_) {}
  }

  await page.evaluate(() => {
    const selectors = [
      "[id*='cookie']", "[class*='cookie']",
      "[id*='consent']", "[class*='consent']",
      "[id*='gdpr']", "[class*='gdpr']",
      ".cookie-banner", ".cookie-consent",
      ".cky-consent-container", ".cmplz-cookiebanner"
    ];

    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        el.style.display = "none";
        el.style.visibility = "hidden";
        el.style.opacity = "0";
      });
    });
  });

  return false;
}

async function analyzeViewport(page, url, viewport) {
  await page.setViewport({
    width: viewport.width,
    height: viewport.height,
    isMobile: viewport.name === "Mobile"
  });

  await page.goto(url, {
    waitUntil: "networkidle2",
    timeout: 45000
  });

  await acceptCookies(page);
  await new Promise(resolve => setTimeout(resolve, 700));

  const result = await page.evaluate((viewportName) => {
    function parseRGB(str) {
      if (!str) return null;
      const nums = str.match(/\d+(\.\d+)?/g);
      if (!nums || nums.length < 3) return null;
      return [Number(nums[0]), Number(nums[1]), Number(nums[2])];
    }

    function getLuminance(r, g, b) {
      const a = [r, g, b].map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    }

    function contrast(rgb1, rgb2) {
      if (!rgb1 || !rgb2) return null;
      const lum1 = getLuminance(...rgb1);
      const lum2 = getLuminance(...rgb2);
      return (Math.max(lum1, lum2) + 0.05) / (Math.min(lum1, lum2) + 0.05);
    }

    function normalizeText(text) {
      return (text || "").replace(/\s+/g, " ").trim();
    }

    function getBackground(el) {
      let node = el;
      while (node && node !== document.documentElement) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") return bg;
        node = node.parentElement;
      }
      return "rgb(255,255,255)";
    }

    function getLineHeight(style, fontSize) {
      if (!style.lineHeight || style.lineHeight === "normal") return fontSize * 1.2;
      if (style.lineHeight.endsWith("px")) return parseFloat(style.lineHeight);
      const value = parseFloat(style.lineHeight);
      if (!Number.isNaN(value)) return value < 10 ? value * fontSize : value;
      return fontSize * 1.2;
    }

    function charsPerLine(width, fontSize) {
      return Math.round(width / (fontSize * 0.52));
    }

    function isVisible(style, rect) {
      return style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width > 8 &&
        rect.height > 8;
    }

    function setLevel(item, level) {
      const order = { good: 0, warning: 1, critical: 2 };
      if (order[level] > order[item.level]) item.level = level;
    }

    const selector = "h1,h2,h3,h4,h5,h6,p,li,blockquote,a,span,div";
    const nodes = Array.from(document.querySelectorAll(selector));
    const data = [];

    nodes.forEach((el, index) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const text = normalizeText(el.innerText || el.textContent || "");

      if (!isVisible(style, rect)) return;
      if (text.length < 4) return;

      const tag = el.tagName;
      const fontSize = parseFloat(style.fontSize);
      if (!fontSize || fontSize <= 0) return;

      const id = `${viewportName}-${index}`;
      el.setAttribute("data-analyzer-id", id);

      const lineHeight = getLineHeight(style, fontSize);
      const contrastValue = contrast(parseRGB(style.color), parseRGB(getBackground(el)));
      const estimatedChars = charsPerLine(rect.width, fontSize);

      const item = {
        id,
        viewport: viewportName,
        tag,
        text: text.slice(0, 120),
        fontSize: Number(fontSize.toFixed(2)),
        lineHeight: Number(lineHeight.toFixed(2)),
        contrast: contrastValue ? Number(contrastValue.toFixed(2)) : null,
        alignment: style.textAlign,
        widthPx: Number(rect.width.toFixed(0)),
        charsPerLine: estimatedChars,
        marginBottom: parseFloat(style.marginBottom) || 0,
        problems: [],
        fixes: [],
        level: "good",
        preview: null
      };

      const lhRatio = lineHeight / fontSize;

      if (["P", "LI", "BLOCKQUOTE", "A", "SPAN", "DIV"].includes(tag) && fontSize < 14) {
        item.problems.push("Font size is too small.");
        item.fixes.push("Increase text size to at least 14–16 px.");
        setLevel(item, fontSize < 12 ? "critical" : "warning");
      }

      if (["P", "LI", "BLOCKQUOTE"].includes(tag) && lhRatio < 1.35) {
        item.problems.push("Line height is too tight.");
        item.fixes.push("Use line-height around 1.4–1.6.");
        setLevel(item, "warning");
      }

      if (contrastValue !== null && contrastValue < 4.5) {
        item.problems.push("Insufficient contrast.");
        item.fixes.push("Increase contrast between text and background.");
        setLevel(item, contrastValue < 3 ? "critical" : "warning");
      }

      if (tag === "P" && style.textAlign === "center") {
        item.problems.push("Centered paragraph text reduces readability.");
        item.fixes.push("Use left-aligned text for longer paragraphs.");
        setLevel(item, "warning");
      }

      if (["P", "LI", "BLOCKQUOTE"].includes(tag) && estimatedChars > 90) {
        item.problems.push("Line length is too long.");
        item.fixes.push("Reduce text width to around 50–75 characters per line.");
        setLevel(item, "warning");
      }

      if (["P", "LI", "BLOCKQUOTE", "H1", "H2", "H3"].includes(tag) && item.marginBottom < 8) {
        item.problems.push("Vertical spacing is too small.");
        item.fixes.push("Increase bottom spacing between text blocks.");
        setLevel(item, "warning");
      }

      if (tag === "H1" && fontSize < 28) {
        item.problems.push("H1 heading is too small.");
        item.fixes.push("Increase H1 size to improve visual hierarchy.");
        setLevel(item, "warning");
      }

      if (item.level === "good") {
        el.style.outline = "3px solid #16a34a";
        el.style.outlineOffset = "3px";
      }

      if (item.level === "warning") {
        el.style.outline = "4px solid #f59e0b";
        el.style.outlineOffset = "3px";
      }

      if (item.level === "critical") {
        el.style.outline = "4px solid #dc2626";
        el.style.outlineOffset = "3px";
      }

      data.push(item);
    });

    const finalData = data.slice(0, 40);

    const stats = {
      total: finalData.length,
      good: finalData.filter(i => i.level === "good").length,
      warnings: finalData.filter(i => i.level === "warning").length,
      critical: finalData.filter(i => i.level === "critical").length
    };

    const score = stats.total
      ? Math.round(((stats.good + stats.warnings * 0.5) / stats.total) * 100)
      : 0;

    return { viewport: viewportName, score, stats, data: finalData };
  }, viewport.name);

  for (const item of result.data) {
    try {
      const elementHandle = await page.$(`[data-analyzer-id="${item.id}"]`);
      if (!elementHandle) continue;

      const box = await elementHandle.boundingBox();
      if (!box) continue;

      const fileName = `${item.id}.png`;

      await page.screenshot({
        path: path.join(previewsDir, fileName),
        clip: {
          x: Math.max(box.x - 30, 0),
          y: Math.max(box.y - 30, 0),
          width: Math.min(box.width + 60, viewport.width),
          height: Math.min(box.height + 60, 500)
        }
      });

      item.preview = `/previews/${fileName}`;
    } catch (_) {}
  }

  await page.screenshot({
    path: `${viewport.name.toLowerCase()}-highlight.png`,
    fullPage: true
  });

  return result;
}

app.get("/analyze", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ error: "No URL provided." });

  let browser;

  try {
    cleanPreviews();

    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const viewports = [
      { name: "Desktop", width: 1440, height: 2200 },
      { name: "Tablet", width: 768, height: 1600 },
      { name: "Mobile", width: 390, height: 1200 }
    ];

    const results = [];

    for (const viewport of viewports) {
      const page = await browser.newPage();
      const viewportResult = await analyzeViewport(page, url, viewport);
      results.push(viewportResult);
      await page.close();
    }

    await browser.close();

    const overallScore = Math.round(
      results.reduce((sum, item) => sum + item.score, 0) / results.length
    );

    res.json({ score: overallScore, responsive: results });

  } catch (err) {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
    res.json({ error: err.message });
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
