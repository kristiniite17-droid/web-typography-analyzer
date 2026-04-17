const express = require("express");
const puppeteer = require("puppeteer");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.static(__dirname));

app.get("/", (req, res) => {
    res.send("Typography Analyzer Running 🚀");
});

app.get("/analyze", async (req, res) => {
    const url = req.query.url;

    if (!url) return res.json({ error: "No URL provided" });

    try {
        const browser = await puppeteer.launch({
            headless: "new",
            args: ["--no-sandbox", "--disable-setuid-sandbox"]
        });

        const page = await browser.newPage();

        await page.goto(url, {
            waitUntil: "networkidle2",
            timeout: 30000
        });

        const result = await page.evaluate(() => {

            function describeElement(el) {
                if (el.innerText && el.innerText.trim()) {
                    return el.innerText.trim().slice(0, 100);
                }
                if (el.tagName === "IMG") return `Image alt: ${el.alt || "no alt"}`;
                if (el.tagName === "A") return `Link: ${el.href}`;
                if (el.id) return `ID: ${el.id}`;
                if (el.className) return `Class: ${el.className}`;
                return `<${el.tagName}> element`;
            }

            function getLuminance(r,g,b){
                const a=[r,g,b].map(v=>{
                    v/=255;
                    return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4);
                });
                return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2];
            }

            function contrast(rgb1, rgb2){
                const lum1 = getLuminance(...rgb1);
                const lum2 = getLuminance(...rgb2);
                return (Math.max(lum1,lum2)+0.05)/(Math.min(lum1,lum2)+0.05);
            }

            function parseRGB(str){
                const nums = str.match(/\d+/g);
                return nums ? nums.map(Number) : [255,255,255];
            }

            const elements = document.querySelectorAll("p,h1,h2,h3,span,img,a");

            let total = 0;
            let good = 0;
            let warnings = 0;
            let critical = 0;

            const data = Array.from(elements).map(el => {

                total++;

                const style = getComputedStyle(el);

                const text = describeElement(el);

                const fontSize = parseFloat(style.fontSize);
                const lineHeight = parseFloat(style.lineHeight);
                const alignment = style.textAlign;
                const marginBottom = parseFloat(style.marginBottom);

                const color = parseRGB(style.color);
                const bg = parseRGB(style.backgroundColor);

                const contrastValue = contrast(color, bg);
                const lineLength = text.length;

                let problems = [];
                let fixes = [];
                let level = "good";

                // CRITICAL
                if (contrastValue < 3) {
                    problems.push("Very low contrast");
                    fixes.push("Increase contrast immediately");
                    level = "critical";
                }

                if (fontSize < 12) {
                    problems.push("Extremely small text");
                    fixes.push("Use minimum 14px");
                    level = "critical";
                }

                // WARNING
                if (fontSize < 14) {
                    problems.push("Small text");
                    fixes.push("Use 14–16px");
                    if (level !== "critical") level = "warning";
                }

                if (lineHeight < fontSize * 1.3) {
                    problems.push("Tight line height");
                    fixes.push("Use 1.4–1.6");
                    if (level !== "critical") level = "warning";
                }

                if (lineLength > 90) {
                    problems.push("Line too long");
                    fixes.push("Limit to 50–75 chars");
                    if (level !== "critical") level = "warning";
                }

                if (alignment === "center" && el.tagName === "P") {
                    problems.push("Centered paragraph");
                    fixes.push("Use left alignment");
                    if (level !== "critical") level = "warning";
                }

                if (marginBottom < 8) {
                    problems.push("Low spacing");
                    fixes.push("Add vertical spacing");
                    if (level !== "critical") level = "warning";
                }

                if (level === "good") good++;
                if (level === "warning") warnings++;
                if (level === "critical") critical++;

                if (level !== "good") {
                    el.style.outline = level === "critical" ? "3px solid red" : "3px solid orange";
                }

                return {
                    tag: el.tagName,
                    text,
                    fontSize: style.fontSize,
                    lineHeight: style.lineHeight,
                    alignment,
                    contrast: contrastValue.toFixed(2),
                    lineLength,
                    level,
                    problems,
                    fixes
                };
            });

            const score = Math.round((good / total) * 100);

            return {
                data,
                score,
                stats: { good, warnings, critical }
            };
        });

        await page.screenshot({
            path: "highlight.png",
            fullPage: true
        });

        await browser.close();

        res.json(result);

    } catch (err) {
        res.json({ error: err.message });
    }
});

app.listen(3000);
