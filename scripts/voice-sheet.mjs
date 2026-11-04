/**
 * Prints the read-aloud sheet for a presenter as a PDF, from the lines in scripts/demo-voiceover.mjs.
 *
 *   node scripts/voice-sheet.mjs <out.pdf>
 */
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { HELLO, INTRO, OUTRO, SCRIPT } from './demo-voiceover.mjs';

const OUT = resolve(process.argv[2] ?? 'Handova-voice-script.pdf');
const lines = [HELLO, INTRO, ...Object.values(SCRIPT), OUTRO];
const html = `<!doctype html><meta charset="utf-8"><style>
  @page { size: A4; margin: 16mm 16mm 14mm }
  body { font: 11.5pt/1.5 Arial, sans-serif; color: #12211a }
  h1 { font-size: 21pt; margin: 0 0 2mm } h2 { font-size: 12.5pt; margin: 6mm 0 2mm; color: #0b6b43 }
  ul { margin: 0; padding-left: 5mm } li { margin-bottom: 1mm }
  ol { margin: 0; padding-left: 8mm } ol li { margin-bottom: 2.6mm; break-inside: avoid; font-size: 12.5pt }
</style>
<h1>Handova demo: read-aloud script</h1>
<p>Thank you for lending us your voice. Please read these ${lines.length} lines into your phone. It takes about 15 minutes.</p>
<h2>How to record</h2>
<ul>
  <li><b>Where:</b> a small, quiet room with curtains or soft furniture. Fans and AC off, phone on silent.</li>
  <li><b>Phone:</b> Voice Memos (iPhone) or Recorder (Android), held a hand's width from your mouth, slightly to one side.</li>
  <li><b>One recording:</b> read all the lines in order. Do not say the numbers.</li>
  <li><b>Between lines:</b> stay silent for 3 full seconds.</li>
  <li><b>Your voice:</b> warm and calm, like telling a friend a story, and a little slower than feels natural.</li>
  <li><b>Exact words:</b> please read them as written. The captions in the video use these same words.</li>
  <li><b>If you slip:</b> stop, wait 3 seconds, and read that whole line again. We keep your last take.</li>
  <li><b>Say:</b> "Near" like the English word · "Han-DOH-vah" · U-S-D-C, U-S-D-T, N-F-T, D-A-O as letters · "DID-it".</li>
  <li><b>Send it back as a file</b> (share the recording as a document), not as a WhatsApp voice note, which lowers the quality.</li>
</ul>
<h2>The lines</h2>
<ol>${lines.map((l) => `<li>${l}</li>`).join('')}</ol>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html);
await page.pdf({ path: OUT, format: 'A4', preferCSSPageSize: true });
await browser.close();
console.log(`wrote ${OUT}`);
