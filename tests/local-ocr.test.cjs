const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");

test("Ask.Me loads Tesseract before its application script", () => {
  assert.ok(html.includes("tesseract.js@5/dist/tesseract.min.js"));
  assert.ok(html.indexOf("tesseract.js") < html.indexOf('src="app.js"'));
});

test("Ask.Me runs local OCR with confidence and image preprocessing", () => {
  assert.ok(app.includes("async function extractLocalOcr(files)"));
  assert.ok(app.includes('Tesseract.createWorker("eng"'));
  assert.ok(app.includes("getImageData"));
  assert.ok(app.includes("confidence"));
  assert.ok(app.includes("[LOW CONFIDENCE"));
  assert.ok(app.includes("worker.terminate()"));
});

test("Ask.Me sends OCR transcript and images with optional media request", () => {
  assert.ok(app.includes("ocrText = await extractLocalOcr(selectedImages)"));
  assert.ok(app.includes("JSON.stringify({ prompt, images, ocrText, includeMedia: true"));
});
