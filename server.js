const express = require("express");
const puppeteer = require("puppeteer");
const cors = require("cors");

const app = express();
app.use(cors());

app.get("/", (req, res) => {
    res.send("Typography Analyzer Running 🚀");
});

app.get("/analyze", async (req, res) => {
    const url = req.query.url;

    if (!url) {
        return res.status(400).json({ error: "No URL provided" });
    }

    let browser;

    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ["--no-sandbox", "--disable-setuid-sandbox"]
        });

        const page = await browser.newPage();

        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 30000
        });

        const data = await page.evaluate(() => {
            const elements = document.querySelectorAll("p,h1,h2,h3,span");

            let total = 0;
            let good = 0;

            const result = Array.from(elements).map(el => {
                total++;

                const style = getComputedStyle(el);

                let text = (el.innerText || "").trim();
                if (!text) text = "[empty]";
                text = text.slice(0, 80);

                const fontSize = parseFloat(style.fontSize);

                let status = "good";

                if (fontSize < 14) {
                    status = "bad";
                } else {
                    good++;
                }

                return {
                    tag: el.tagName,
                    text,
                    fontSize: style.fontSize,
                    status
                };
            });

            const score = Math.round((good / total) * 100);

            return { score, result };
        });

        await browser.close();

        res.json(data);

    } catch (err) {
        if (browser) await browser.close();

        res.status(500).json({
            error: err.message
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Server running on port", PORT);
});
