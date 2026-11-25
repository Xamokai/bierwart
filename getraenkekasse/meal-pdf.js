"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { PDFDocument, PageSizes, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const sharp = require("sharp");
const decodeHeic = require("heic-decode");

const margin = 44;
const width = PageSizes.A4[0] - 2 * margin;
const black = rgb(0.10, 0.10, 0.10);
const gray = rgb(0.48, 0.48, 0.48);
const money = new Intl.NumberFormat("de-DE", {style:"currency", currency:"EUR"});
const euro = value => money.format(value ?? 0);
const dateDE = iso => String(iso || "").split("-").reverse().join(".");
const {supported, linesFor} = require("./pdf-text");
const receiptName = /^\d+-[a-f0-9]{12}\.(?:jpg|png|webp|gif|heic|heif)$/i;

function write(page, text, x, y, font, size = 10) {
  page.drawText(supported(text, font), {x, y, size, font, color:black});
}
function rule(page, y) {
  page.drawLine({start:{x:margin,y}, end:{x:margin + width,y}, thickness:0.6, color:gray});
}
// Koordinaten der Druckvorlage in PDF-Punkten, von der oberen Blattkante gemessen.
const sheet = {rows:18, rowStep:19.842, firstBaseline:310.5, left:57, right:526};

function ink(page, text, x, baseline, font, size = 10) {
  write(page, text, x, page.getHeight() - baseline, font, size);
}

function fillForm(doc, meal, template, participantTable, regular, bold) {
  const notes = [];
  const addNote = (label, value) => {
    notes.push({label, value});
    return "[" + notes.length + "]";
  };

  // Bei langen Namen zuerst den Zeilenraum nutzen. Darüber hinaus verweist
  // das Feld auf den vollständigen Inhalt in einer Anlage direkt nach dem Formular.
  function cell(page, label, value, x, baseline, span, {right = false, twoLines = false} = {}) {
    let text = supported(value, regular);
    if (!text) return;
    let size = 10;
    const measure = (str, pt) => regular.widthOfTextAtSize(str, pt);
    if (measure(text, size) > span) {
      size = Math.min(size, Math.max(8, size * span / measure(text, size)));
      if (measure(text, size) > span + 0.01) {
        if (twoLines) {
          const lines = linesFor(text, regular, 8, span);
          if (lines.length === 2) {
            lines.forEach((line, i) => ink(page, line, x, baseline - 7.5 + i * 8.5, regular, 8));
            return;
          }
        }
        const marker = addNote(label, text);
        let prefix = "";
        for (const letter of text) {
          if (measure(prefix + letter + "… " + marker, size) > span) break;
          prefix += letter;
        }
        text = prefix.trimEnd() + "… " + marker;
      }
    }
    ink(page, text, right ? x + span - measure(text, size) : x, baseline, regular, size);
  }

  const pageSize = [template.width, template.height];
  const first = doc.addPage(pageSize);
  first.drawPage(template);
  cell(first, "B-Nr.", meal.identifier, 463, 113, 62);
  cell(first, "Datum", dateDE(meal.date), 98, 133, 166);
  cell(first, "Verantwortlicher", meal.responsible, 352, 133, 170, {twoLines:true});
  cell(first, "Gericht", meal.name, 99, 152.9, 422, {twoLines:true});

  const payers = meal.payouts?.length ? meal.payouts : [{name:meal.payer?.name, amount:meal.total}];
  const payout = p => (p.name || "–") + " · " + euro(p.amount);
  let payerLines = payers.map(payout);
  if (payerLines.length > 3) {
    const marker = addNote("Weitere Auslagen", payerLines.slice(2).join(" / "));
    payerLines = [...payerLines.slice(0, 2), "Weitere Auslagen " + marker];
  }
  payerLines.forEach((line, i) => cell(first, "Auslagen", line, 134, 210 + i * 13, 388));
  const receiptCount = meal.receipts.length;
  const receipts = receiptCount === 1 ? "1 Rechnung im Anhang"
    : receiptCount ? receiptCount + " Rechnungen im Anhang" : "Keine Rechnung hinterlegt";
  ink(first, receipts, 134, 249, regular, 8.5);

  function sheetHeading(page, title) {
    ink(page, title, sheet.left, 82, bold, 14);
    // Der vollständige Bezeichner steht bei Bedarf im Anlagenverzeichnis.
    const label = [dateDE(meal.date), meal.identifier].filter(Boolean).join(" · ");
    const line = linesFor(label, regular, 10, sheet.right - sheet.left)[0];
    ink(page, line, sheet.left, 103, regular);
  }

  // Auf Folgeblättern wird nur das originale Teilnehmer-Raster wiederverwendet.
  // Der Abrechnungsblock auf dem ersten Blatt gilt für das gesamte Essen.
  const tableShift = -144;
  function continuation() {
    const page = doc.addPage(pageSize);
    sheetHeading(page, "Teilnehmer · Fortsetzung");
    const bottom = template.height - (653.3 + tableShift);
    page.drawPage(participantTable, {x:54, y:bottom});
    return page;
  }

  let page = first;
  meal.participants.forEach((person, index) => {
    const row = index % sheet.rows;
    if (index && !row) page = continuation();
    const baseline = sheet.firstBaseline + row * sheet.rowStep + (page === first ? 0 : tableShift);
    cell(page, "Teilnehmer " + (index + 1), person.name, 58, baseline, 143, {twoLines:true});
    const boxX = person.role === "aktiv" ? 416.65 : person.role === "kgast" ? 440.45 : null;
    if (boxX !== null) {
      const y = page.getHeight() - (baseline - 2.78);
      for (const slope of [-1, 1]) {
        page.drawLine({start:{x:boxX - 2.5,y:y - slope * 2.5},end:{x:boxX + 2.5,y:y + slope * 2.5},
          color:black, thickness:0.95});
      }
    }
    if (Number.isFinite(person.price))
      cell(page, "Einzelbetrag " + (index + 1), euro(person.price), 463, baseline, 58, {right:true});
  });

  function shareFor(roles) {
    const prices = new Set(meal.participants.filter(p => roles.includes(p.role) && Number.isFinite(p.price)).map(p => p.price));
    if (prices.size > 1) return "siehe Einzelbeträge";
    return prices.size ? euro([...prices][0]) : "–";
  }
  const amounts = [meal.subsidyPerPerson, meal.total, meal.subsidy, meal.total - meal.subsidy];
  amounts.forEach((value, i) => cell(first, ["Zuschuss", "Auslagen gesamt", "Zuschuss gesamt", "Auslagen rest"][i],
    Number.isFinite(value) ? euro(value) : "–", 130, 688.5 + i * sheet.rowStep, 73, {right:true}));
  cell(first, "Buchungsnummer", meal.identifier, 335, 688.5, 186);
  cell(first, "Kosten pro Aktiv/K-Gast", shareFor(["aktiv", "kgast"]), 354, 708.1, 167);
  cell(first, "Kosten pro Gast/Philister", shareFor(["voll"]), 365, 728.0, 156);
  const remarks = [];
  if (meal.guestShare) remarks.push("Gastanteil (4730) " + euro(meal.guestShare));
  if (meal.participants.some(p => !p.role)) remarks.push("Gruppe teils nicht erfasst");
  if (!meal.participants.length) remarks.push("Keine Teilnehmer hinterlegt");
  cell(first, "Anmerkung", remarks.join(" · "), 331, 747.5, 190, {twoLines:true});

  let y = 0;
  for (const [i, entry] of notes.entries()) {
    for (const line of linesFor("[" + (i + 1) + "] " + entry.label + " – " + entry.value, regular, 10, sheet.right - sheet.left)) {
      if (y === 0 || y > 746) {
        page = doc.addPage(pageSize);
        sheetHeading(page, "Ergänzende Angaben zum Aktivenessen");
        y = 135;
      }
      ink(page, line, sheet.left, y, regular);
      y += 14;
    }
    y += 6;
  }
}

async function jpegReceipt(file) {
  const raw = await fs.readFile(file);
  let image;
  try {
    if (/\.(heic|heif)$/i.test(file)) {
      const {data, width, height} = await decodeHeic({buffer:raw});
      image = sharp(Buffer.from(data), {raw:{width,height,channels:4}, limitInputPixels:50_000_000});
    } else image = sharp(raw, {limitInputPixels:50_000_000}).rotate();
    return await image.resize({width:2200,height:2400,fit:"inside",withoutEnlargement:true})
      .flatten({background:"#fff"}).jpeg({quality:88}).toBuffer();
  } catch (error) {
    throw Error("Rechnungsbild konnte nicht gelesen werden.", {cause:error});
  }
}
async function addReceiptPages(doc, meal, directory, regular, bold) {
  for (const [index, file] of meal.receipts.entries()) {
    if (!receiptName.test(file)) throw Error("Ungültiger Dateiname in den Rechnungen.");
    let image;
    try {
      image = await doc.embedJpg(await jpegReceipt(path.join(directory, file)));
    } catch (error) {
      throw Error(`Rechnung ${index + 1} zu ${meal.identifier} fehlt oder kann nicht gelesen werden.`, {cause:error});
    }
    const page = doc.addPage(PageSizes.A4);
    const caption = `Rechnung ${index + 1} von ${meal.receipts.length} · ${meal.identifier}`;
    const lines = linesFor(caption, bold, 13, width);
    lines.forEach((line, n) => ink(page, line, margin, 54 + 16 * n, bold, 13));
    const top = page.getHeight() - 77 - (lines.length - 1) * 16;
    rule(page, top + 10);
    const size = image.scaleToFit(width, top - 77);
    page.drawImage(image, {x:margin + (width - size.width)/2,y:top - size.height,...size});
  }
}
async function buildMealPdf(meals, receiptsDirectory, title) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fontDirectory = path.join(__dirname, "fonts");
  const [regular, bold] = await Promise.all(["DejaVuSans.ttf","DejaVuSans-Bold.ttf"].map(async file =>
    doc.embedFont(await fs.readFile(path.join(fontDirectory,file)), {subset:true})));
  const formFile = await fs.readFile(path.join(__dirname, "forms", "aktivenessen-2024.pdf"));
  const [template, participantTable] = await doc.embedPdf(formFile, [0, 1]);
  doc.setTitle(title);
  for (const meal of meals) {
    fillForm(doc, meal, template, participantTable, regular, bold);
    await addReceiptPages(doc, meal, receiptsDirectory, regular, bold);
  }
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const label = "Seite " + (i + 1) + " von " + pages.length;
    ink(page, label, (page.getWidth() - regular.widthOfTextAtSize(label, 9)) / 2, 781.6, regular, 9);
  });
  return doc.save();
}

module.exports = { buildMealPdf };
