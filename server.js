const express = require("express");
const puppeteer = require("puppeteer");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.send("Typography Analyzer is running 🚀");
});

app.get("/analyze", async (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.json({ error: "No URL provided." });
  }

  let browser;

  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 2200 });

    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 45000
    });

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
          const href = el.href || "";
          if (aria) return `Link: ${aria}`;
          if (title) return `Link: ${title}`;
          return href ? `Link: ${href}` : "Link element";
        }

        const aria = normalizeText(el.getAttribute("aria-label") || "");
        if (aria) return aria;

        if (el.id) return `ID: ${el.id}`;
        if (typeof el.className === "string" && el.className.trim()) {
          return `Class: ${el.className.trim()}`;
        }

        return `<${el.tagName.toLowerCase()}> element`;
      }

      function isVisible(style, rect) {
        if (style.display === "none") return false;
        if (style.visibility === "hidden") return false;
        if (Number(style.opacity) === 0) return false;
        if (rect.width < 8 || rect.height < 8) return false;
        return true;
      }

      function isMeaningful(el, style, text) {
        const tag = el.tagName;
        const textLen = text.length;

        if (["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "PATH"].includes(tag)) return false;
        if (style.position === "fixed" && textLen < 8) return false;

        if (["H1", "H2", "H3", "H4", "H5", "H6", "P", "LI", "BLOCKQUOTE"].includes(tag)) {
          return true;
        }

        if (tag === "A" && textLen >= 4) return true;
        if ((tag === "SPAN" || tag === "DIV") && textLen >= 20) return true;
        if (tag === "IMG" && normalizeText(el.getAttribute("alt") || "").length > 0) return true;

        return false;
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
        if (!rectWidth || !avgCharWidth) return text.length;
        return Math.round(rectWidth / avgCharWidth);
      }

      const selector = [
        "h1", "h2", "h3", "h4", "h5", "h6",
        "p", "li", "blockquote", "a", "span", "div", "img"
      ].join(",");

      const nodes = Array.from(document.querySelectorAll(selector));
      const headingSizes = [];
      const collected = [];

      for (const el of nodes) {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const text = normalizeText(el.innerText || el.textContent || "");

        if (!isVisible(style, rect)) continue;
        if (!isMeaningful(el, style, text)) continue;

        const fontSize = parseFloat(style.fontSize);
        if (Number.isNaN(fontSize) || fontSize <= 0) continue;

        const lineHeightPx = getNumericLineHeight(style, fontSize);
        const bg = getEffectiveBackground(el);
        const contrastValue = contrast(parseRGB(style.color), parseRGB(bg));

        const marginBottom = parseFloat(style.marginBottom) || 0;
        const marginTop = parseFloat(style.marginTop) || 0;
        const paddingBottom = parseFloat(style.paddingBottom) || 0;
        const paddingTop = parseFloat(style.paddingTop) || 0;

        const widthPx = rect.width;
        const charsPerLine = estimateCharactersPerLine(text || describeElement(el), widthPx, fontSize);

        const item = {
          tag: el.tagName,
          text: describeElement(el),
          fontSize: Number(fontSize.toFixed(2)),
          lineHeight: Number(lineHeightPx.toFixed(2)),
          alignment: style.textAlign,
          contrast: contrastValue ? Number(contrastValue.toFixed(2)) : null,
          widthPx: Number(widthPx.toFixed(0)),
          charsPerLine,
          marginBottom,
          marginTop,
          paddingBottom,
          paddingTop,
          problems: [],
          fixes: [],
          level: "good"
        };

        if (/^H[1-6]$/.test(el.tagName)) {
          headingSizes.push({
            tag: el.tagName,
            size: fontSize
          });
        }

        collected.push({ el, item });
      }

      function setLevel(item, newLevel) {
        const order = { good: 0, warning: 1, critical: 2 };
        if (order[newLevel] > order[item.level]) {
          item.level = newLevel;
        }
      }

      for (const { el, item } of collected) {
        const tag = item.tag;
        const lhRatio = item.lineHeight / item.fontSize;

        if (["P", "LI", "BLOCKQUOTE", "A", "SPAN", "DIV"].includes(tag) && item.fontSize < 14) {
          item.problems.push("Font size is too small.");
          item.fixes.push("Increase the base text size to at least 14–16 px.");
          setLevel(item, item.fontSize < 12 ? "critical" : "warning");
        }

        if (["P", "LI", "BLOCKQUOTE"].includes(tag) && lhRatio < 1.35) {
          item.problems.push("Line height is too tight.");
          item.fixes.push("Use a line-height of approximately 1.4–1.6.");
          setLevel(item, "warning");
        }

        if (item.contrast !== null && item.contrast < 4.5) {
          item.problems.push("Insufficient contrast between text and background.");
          item.fixes.push("Increase contrast to comply with WCAG accessibility guidance.");
          setLevel(item, item.contrast < 3 ? "critical" : "warning");
        }

        if (tag === "P" && item.alignment === "center") {
          item.problems.push("Centered paragraph text reduces readability.");
          item.fixes.push("Use left-aligned text for longer body paragraphs.");
          setLevel(item, "warning");
        }

        if (["P", "LI", "BLOCKQUOTE"].includes(tag) && item.charsPerLine > 90) {
          item.problems.push("Line length is too long.");
          item.fixes.push("Reduce text width to keep lines around 50–75 characters.");
          setLevel(item, "warning");
        }

        if (
          ["P", "LI", "BLOCKQUOTE", "H1", "H2", "H3"].includes(tag) &&
          item.marginBottom < 8 &&
          item.paddingBottom < 4
        ) {
          item.problems.push("Vertical spacing below the element is too small.");
          item.fixes.push("Increase spacing between text blocks, for example with 12–24 px bottom margin.");
          setLevel(item, "warning");
        }

        if (tag === "H1" && item.fontSize < 28) {
          item.problems.push("The H1 heading is too small.");
          item.fixes.push("Increase H1 size to create a stronger visual hierarchy.");
          setLevel(item, "warning");
        }

        if (tag === "H2" && item.fontSize < 22) {
          item.problems.push("The H2 heading is too small.");
          item.fixes.push("Increase H2 size so it clearly differs from body text.");
          setLevel(item, "warning");
        }

        if (item.level !== "good") {
          el.style.outline = item.level === "critical" ? "3px solid red" : "3px solid orange";
          el.style.outlineOffset = "2px";
          if (item.level === "critical") {
            el.style.backgroundColor = "rgba(255,0,0,0.08)";
          } else {
            el.style.backgroundColor = "rgba(255,165,0,0.08)";
          }
        }
      }

      const sizeMap = {};
      for (const h of headingSizes) {
        if (!sizeMap[h.tag]) sizeMap[h.tag] = [];
        sizeMap[h.tag].push(h.size);
      }

      const avg = (arr) => arr && arr.length
        ? arr.reduce((a, b) => a + b, 0) / arr.length
        : null;

      const h1Avg = avg(sizeMap.H1);
      const h2Avg = avg(sizeMap.H2);
      const h3Avg = avg(sizeMap.H3);

      const hierarchyWarnings = [];
      if (h1Avg && h2Avg && h2Avg >= h1Avg) {
        hierarchyWarnings.push("H2 headings are not smaller than H1 headings.");
      }
      if (h2Avg && h3Avg && h3Avg >= h2Avg) {
        hierarchyWarnings.push("H3 headings are not smaller than H2 headings.");
      }

      if (hierarchyWarnings.length) {
        for (const entry of collected) {
          if (["H1", "H2", "H3"].includes(entry.item.tag)) {
            entry.item.problems.push(...hierarchyWarnings);
            entry.item.fixes.push("Review heading size hierarchy across the page.");
            setLevel(entry.item, "warning");
          }
        }
      }

      const finalData = collected.map(({ item }) => item).slice(0, 40);

      const stats = {
        total: finalData.length,
        good: finalData.filter(i => i.level === "good").length,
        warnings: finalData.filter(i => i.level === "warning").length,
        critical: finalData.filter(i => i.level === "critical").length
      };

      const score = stats.total
        ? Math.max(
            0,
            Math.round(
              ((stats.good * 1 + stats.warnings * 0.5 + stats.critical * 0) / stats.total) * 100
            )
          )
        : 0;

      return { data: finalData, stats, score };
    });

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
    res.json({ error: err.message });
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
