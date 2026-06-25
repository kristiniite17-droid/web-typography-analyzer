const express = require("express");
const puppeteer = require("puppeteer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.static(__dirname));

const previewsDir = path.join(__dirname, "previews");

if (!fs.existsSync(previewsDir)) {
  fs.mkdirSync(previewsDir);
}

app.get("/", (req, res) => {
  res.send("Tipografika is running 🚀");
});

async function handleCookieBanner(page) {
  const acceptTexts = [
    "Accept",
    "Accept all",
    "Accept All",
    "Accept cookies",
    "Allow all",
    "Allow cookies",
    "I agree",
    "Agree",
    "OK",
    "Got it",
    "Continue",
    "Piekrītu",
    "Piekrist",
    "Apstiprināt",
    "Akceptēt",
    "Labi",
    "Saprotu",
    "Принять",
    "Согласен",
    "Разрешить"
  ];

  for (const text of acceptTexts) {
    try {
      const clicked = await page.evaluate((text) => {
        const elements = Array.from(
          document.querySelectorAll(
            "button, a, input[type='button'], input[type='submit']"
          )
        );

        const target = elements.find((el) => {
          const value = (el.innerText || el.value || "").trim().toLowerCase();
          return value === text.toLowerCase() || value.includes(text.toLowerCase());
        });

        if (target) {
          target.click();
          return true;
        }

        return false;
      }, text);

      if (clicked) {
        await new Promise(resolve => setTimeout(resolve, 1200));
        return true;
      }
    } catch (_) {}
  }

  try {
    await page.evaluate(() => {
      const selectors = [
        "[id*='cookie']",
        "[class*='cookie']",
        "[id*='Cookie']",
        "[class*='Cookie']",
        "[id*='consent']",
        "[class*='consent']",
        "[id*='Consent']",
        "[class*='Consent']",
        "[id*='gdpr']",
        "[class*='gdpr']",
        ".cc-window",
        ".cookie-banner",
        ".cookie-consent",
        ".cookies",
        "#cookieNotice",
        "#cookieConsent",
        "#cookiescript_injected",
        ".cky-consent-container",
        ".cmplz-cookiebanner"
      ];

      selectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((el) => {
          el.style.display = "none";
          el.style.visibility = "hidden";
          el.style.opacity = "0";
          el.style.pointerEvents = "none";
        });
      });
    });
  } catch (_) {}

  return false;
}

app.get("/analyze", async (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.json({ error: "No URL provided." });
  }

  let browser;

  try {
    fs.readdirSync(previewsDir).forEach((file) => {
      fs.unlinkSync(path.join(previewsDir, file));
    });

    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();

    await page.setViewport({
      width: 1440,
      height: 2200
    });

    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 45000
    });

    await handleCookieBanner(page);
    await new Promise(resolve => setTimeout(resolve, 1000));

    const result = await page.evaluate(() => {
      function parseRGB(str) {
        if (!str) return null;
        const nums = str.match(/\d+(\.\d+)?/g);
        if (!nums || nums.length < 3) return null;
        return [Number(nums[0]), Number(nums[1]), Number(nums[2])];
      }

      function getLuminance(r, g, b) {
        const a = [r, g, b].map((v) => {
          v /= 255;
          return v <= 0.03928
            ? v / 12.92
            : Math.pow((v + 0.055) / 1.055, 2.4);
        });

        return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
      }

      function contrast(rgb1, rgb2) {
        if (!rgb1 || !rgb2) return null;

        const lum1 = getLuminance(...rgb1);
        const lum2 = getLuminance(...rgb2);

        return (Math.max(lum1, lum2) + 0.05) / (Math.min(lum1, lum2) + 0.05);
      }

      function isTransparentColor(value) {
        return (
          !value ||
          value === "transparent" ||
          value === "rgba(0, 0, 0, 0)" ||
          value === "rgba(0,0,0,0)"
        );
      }

      function getEffectiveBackground(el) {
        let node = el;

        while (node && node !== document.documentElement) {
          const bg = getComputedStyle(node).backgroundColor;

          if (!isTransparentColor(bg)) {
            return bg;
          }

          node = node.parentElement;
        }

        return "rgb(255,255,255)";
      }

      function normalizeText(text) {
        return (text || "").replace(/\s+/g, " ").trim();
      }

      function describeElement(el) {
        const text = normalizeText(el.innerText || el.textContent || "");

        if (text) return text.slice(0, 120);

        if (el.tagName === "IMG") {
          const alt = normalizeText(el.getAttribute("alt") || "");
          return alt ? `Image alt: ${alt}` : "Image without alt text";
        }

        if (el.tagName === "A") {
          const aria = normalizeText(el.getAttribute("aria-label") || "");
          const title = normalizeText(el.getAttribute("title") || "");

          if (aria) return `Link: ${aria}`;
          if (title) return `Link: ${title}`;
          return el.href ? `Link: ${el.href}` : "Link element";
        }

        if (el.id) return `ID: ${el.id}`;

        if (typeof el.className === "string" && el.className.trim()) {
          return `Class: ${el.className.trim()}`;
        }

        return `<${el.tagName.toLowerCase()}> element`;
      }

      function getNumericLineHeight(style, fontSize) {
        if (!style.lineHeight || style.lineHeight === "normal") {
          return fontSize * 1.2;
        }

        if (style.lineHeight.endsWith("px")) {
          return parseFloat(style.lineHeight);
        }

        const numeric = parseFloat(style.lineHeight);

        if (!Number.isNaN(numeric)) {
          if (numeric < 10) return numeric * fontSize;
          return numeric;
        }

        return fontSize * 1.2;
      }

      function estimateCharactersPerLine(text, rectWidth, fontSize) {
        const avgCharWidth = fontSize * 0.52;
        return Math.round(rectWidth / avgCharWidth);
      }

      function isVisible(style, rect) {
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) !== 0 &&
          rect.width >= 8 &&
          rect.height >= 8
        );
      }

      function isMeaningful(el, text) {
        const tag = el.tagName;
        const len = text.length;

        if (
          ["H1", "H2", "H3", "H4", "H5", "H6", "P", "LI", "BLOCKQUOTE"].includes(tag)
        ) {
          return true;
        }

        if (tag === "A" && len >= 4) return true;
        if ((tag === "SPAN" || tag === "DIV") && len >= 20) return true;
        if (tag === "IMG" && normalizeText(el.getAttribute("alt") || "").length > 0) return true;

        return false;
      }

      const selector = "h1,h2,h3,h4,h5,h6,p,li,blockquote,a,span,div,img";
      const nodes = Array.from(document.querySelectorAll(selector));

      const collected = [];

      nodes.forEach((el, index) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const rawText = normalizeText(el.innerText || el.textContent || "");

        if (!isVisible(style, rect)) return;
        if (!isMeaningful(el, rawText)) return;

        const fontSize = parseFloat(style.fontSize);

        if (!fontSize || fontSize <= 0) return;

        const id = `analyzed-element-${index}`;
        el.setAttribute("data-analyzer-id", id);

        const lineHeight = getNumericLineHeight(style, fontSize);
        const bg = getEffectiveBackground(el);
        const contrastValue = contrast(parseRGB(style.color), parseRGB(bg));

        const item = {
          id,
          tag: el.tagName,
          text: describeElement(el),
          fontSize: Number(fontSize.toFixed(2)),
          lineHeight: Number(lineHeight.toFixed(2)),
          alignment: style.textAlign,
          contrast: contrastValue ? Number(contrastValue.toFixed(2)) : null,
          widthPx: Number(rect.width.toFixed(0)),
          heightPx: Number(rect.height.toFixed(0)),
          charsPerLine: estimateCharactersPerLine(
            rawText || describeElement(el),
            rect.width,
            fontSize
          ),
          marginBottom: parseFloat(style.marginBottom) || 0,
          problems: [],
          fixes: [],
          details: [],
          level: "good"
        };

        collected.push({ el, item });
      });

      function setLevel(item, newLevel) {
        const order = {
          good: 0,
          warning: 1,
          critical: 2
        };

        if (order[newLevel] > order[item.level]) {
          item.level = newLevel;
        }
      }

      for (const { el, item } of collected) {
        const tag = item.tag;
        const lhRatio = item.lineHeight / item.fontSize;

        if (
          ["P", "LI", "BLOCKQUOTE", "A", "SPAN", "DIV"].includes(tag) &&
          item.fontSize < 14
        ) {
          item.problems.push("Font size is too small.");
          item.fixes.push("Increase the base text size to at least 14–16 px.");
          item.details.push(
            "Small text can reduce readability, especially on mobile screens and for users with weaker vision."
          );

          setLevel(item, item.fontSize < 12 ? "critical" : "warning");
        }

        if (["P", "LI", "BLOCKQUOTE"].includes(tag) && lhRatio < 1.35) {
          item.problems.push("Line height is too tight.");
          item.fixes.push("Use a line-height of approximately 1.4–1.6.");
          item.details.push(
            "Tight line spacing makes it harder for users to move from one line to the next."
          );

          setLevel(item, "warning");
        }

        if (item.contrast !== null && item.contrast < 4.5) {
          item.problems.push("Insufficient contrast between text and background.");
          item.fixes.push("Increase contrast to comply with WCAG accessibility guidance.");
          item.details.push(
            "Low contrast makes text harder to read and can create accessibility problems."
          );

          setLevel(item, item.contrast < 3 ? "critical" : "warning");
        }

        if (tag === "P" && item.alignment === "center") {
          item.problems.push("Centered paragraph text reduces readability.");
          item.fixes.push("Use left-aligned text for longer body paragraphs.");
          item.details.push(
            "Centered long text has an uneven starting point for each line, which slows down reading."
          );

          setLevel(item, "warning");
        }

        if (["P", "LI", "BLOCKQUOTE"].includes(tag) && item.charsPerLine > 90) {
          item.problems.push("Line length is too long.");
          item.fixes.push("Reduce text width to keep lines around 50–75 characters.");
          item.details.push(
            "Long lines make it harder for the eye to return to the next line accurately."
          );

          setLevel(item, "warning");
        }

        if (
          ["P", "LI", "BLOCKQUOTE", "H1", "H2", "H3"].includes(tag) &&
          item.marginBottom < 8
        ) {
          item.problems.push("Vertical spacing below the element is too small.");
          item.fixes.push(
            "Increase spacing between text blocks, for example with 12–24 px bottom margin."
          );
          item.details.push(
            "Insufficient vertical spacing makes content feel visually crowded."
          );

          setLevel(item, "warning");
        }

        if (tag === "H1" && item.fontSize < 28) {
          item.problems.push("The H1 heading is too small.");
          item.fixes.push("Increase H1 size to create a stronger visual hierarchy.");
          item.details.push(
            "The main heading should clearly stand out from body text and secondary headings."
          );

          setLevel(item, "warning");
        }

        if (item.level !== "good") {
          el.style.outline = item.level === "critical"
            ? "4px solid red"
            : "4px solid orange";

          el.style.outlineOffset = "3px";

          el.style.backgroundColor = item.level === "critical"
            ? "rgba(255,0,0,0.10)"
            : "rgba(255,165,0,0.12)";
        }
      }

      const finalData = collected.map(({ item }) => item).slice(0, 40);

      const stats = {
        total: finalData.length,
        good: finalData.filter((i) => i.level === "good").length,
        warnings: finalData.filter((i) => i.level === "warning").length,
        critical: finalData.filter((i) => i.level === "critical").length
      };

      const score = stats.total
        ? Math.round(((stats.good + stats.warnings * 0.5) / stats.total) * 100)
        : 0;

      return {
        data: finalData,
        stats,
        score
      };
    });

    for (const item of result.data.filter((i) => i.level !== "good").slice(0, 20)) {
      try {
        const elementHandle = await page.$(`[data-analyzer-id="${item.id}"]`);

        if (elementHandle) {
          const box = await elementHandle.boundingBox();

          if (box) {
            const clip = {
              x: Math.max(box.x - 20, 0),
              y: Math.max(box.y - 20, 0),
              width: Math.min(box.width + 40, 1400),
              height: Math.min(box.height + 40, 800)
            };

            const fileName = `${item.id}.png`;

            await page.screenshot({
              path: path.join(previewsDir, fileName),
              clip
            });

            item.preview = `/previews/${fileName}`;
          }
        }
      } catch (_) {}
    }

    await page.screenshot({
      path: "highlight.png",
      fullPage: true
    });

    await browser.close();

    res.json(result);

  } catch (err) {
    if (browser) {
      try {
        await browser.close();
      } catch (_) {}
    }

    res.json({
      error: err.message
    });
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
