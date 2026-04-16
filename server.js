const express = require("express");
const puppeteer = require("puppeteer");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.static(__dirname));

app.get("/", (req, res) => {
    res.send("Ultimate Analyzer Running 🚀");
});

app.get("/analyze", async (req, res) => {
    const url = req.query.url;

    if (!url) return res.json({ error: "No URL" });

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

            const elements = document.querySelectorAll("p,h1,h2,h3,span");

            let total = 0;
            let good = 0;

            const data = Array.from(elements).map(el => {

                total++;

                const style = getComputedStyle(el);

                let text = el.innerText || "";
                text = text.replace(/\s+/g, " ").trim();
                if (!text) text = "[No text]";
                text = text.slice(0, 80);

                const fontSize = parseFloat(style.fontSize);
                const lineHeight = parseFloat(style.lineHeight);

                const color = parseRGB(style.color);
                const bg = parseRGB(style.backgroundColor);

                const contrastValue = contrast(color, bg);

                let problems = [];
                let fixes = [];
                let status = "good";

                if (fontSize < 14) {
                    problems.push("Font too small");
                    fixes.push("Use 14–16px");
                    status = "bad";
                }

                if (lineHeight < 1.3) {
                    problems.push("Line height too small");
                    fixes.push("Use 1.4–1.6");
                    status = "bad";
                }

                if (contrastValue < 4.5) {
                    problems.push("Low contrast");
                    fixes.push("Increase contrast");
                    status = "bad";
                }

                if (status === "good") good++;

                if (status === "bad") {
                    el.style.outline = "3px solid red";
                    el.style.backgroundColor = "rgba(255,0,0,0.1)";
                }

                return {
                    tag: el.tagName,
                    text,
                    fontSize: style.fontSize,
                    lineHeight: style.lineHeight,
                    contrast: contrastValue.toFixed(2),
                    problems,
                    fixes,
                    status
                };
            });

            const score = Math.round((good / total) * 100);

            return { data, score };
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
