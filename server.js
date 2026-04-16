const express = require("express");
const puppeteer = require("puppeteer");
const cors = require("cors");
const PDFDocument = require("pdfkit");
const fs = require("fs");

const app = express();
app.use(cors());

app.get("/", (req, res) => {
    res.send("Advanced Analyzer Running 🚀");
});

function getSeverity(score) {
    if (score < 50) return "critical";
    if (score < 75) return "medium";
    return "low";
}

app.get("/analyze", async (req, res) => {
    const url = req.query.url;
    if (!url) return res.json({ error: "No URL" });

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

        const elements = document.querySelectorAll("p,h1,h2,h3,span,button,a");

        let total = 0;
        let good = 0;

        const issues = [];

        const data = Array.from(elements).map(el => {
            total++;

            const style = getComputedStyle(el);

            let text = (el.innerText || "").trim().slice(0, 80);
            if (!text) text = "[empty]";

            const fontSize = parseFloat(style.fontSize);
            const lineHeight = parseFloat(style.lineHeight);

            let status = "good";
            let problems = [];
            let fix = [];

            if (fontSize < 14) {
                problems.push("Font too small");
                fix.push("Increase to 14–18px");
                status = "bad";
            }

            if (lineHeight < 1.3) {
                problems.push("Line spacing too tight");
                fix.push("Use 1.4–1.6");
                status = "bad";
            }

            if (status === "good") good++;

            if (status === "bad") {
                el.style.outline = "3px solid red";
                el.style.backgroundColor = "rgba(255,0,0,0.1)";
            }

            if (status === "bad") {
                issues.push({
                    text,
                    tag: el.tagName,
                    problems,
                    fix
                });
            }

            return {
                tag: el.tagName,
                text,
                fontSize: style.fontSize,
                lineHeight: style.lineHeight,
                status
            };
        });

        const score = Math.round((good / total) * 100);

        return { data, score, issues };
    });

    const screenshotPath = "site.png";

    await page.screenshot({
        path: screenshotPath,
        fullPage: true
    });

    await browser.close();

    res.json({
        url,
        score: result.score,
        severity: getSeverity(result.score),
        issues: result.issues.slice(0, 10),
        screenshot: "/image"
    });
});

// 📸 screenshot endpoint
app.get("/image", (req, res) => {
    res.sendFile(__dirname + "/site.png");
});

// 📄 PDF REPORT
app.get("/report", async (req, res) => {
    const url = req.query.url;

    const doc = new PDFDocument();
    res.setHeader("Content-Type", "application/pdf");

    doc.text("Typography Analysis Report");
    doc.text("URL: " + url);
    doc.text("Score generated from system analysis.");
    doc.pipe(res);
    doc.end();
});

app.listen(3000, () => console.log("Running"));
