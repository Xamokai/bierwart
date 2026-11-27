"use strict";
// Zuerst ui-preview.cjs starten. Der Test bucht ausschließlich in dessen lokale Testkasse.
const {chromium} = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");

async function run() {
  const port=process.argv[2] || "3182", base="http://127.0.0.1:"+port;
  const browser=await chromium.launch(process.env.CHROMIUM ? {executablePath:process.env.CHROMIUM} : {});
  const faults=[];
  const suffix=Date.now().toString(36);
  async function open(width,height,touch) {
    const context=await browser.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch,locale:"de-DE"});
    const page=await context.newPage();
    page.on("pageerror",err=>faults.push(err.message));
    page.setDefaultTimeout(8000);
    return page;
  }
  async function fit(page) {
    const sizes=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);
    assert(sizes[0]<=sizes[1]+1,"Überbreite "+sizes.join("/"));
  }
  async function checkAreaLinks(page, captionsVisible) {
    const nav = page.getByRole("navigation",{name:"Kasse"});
    for (const name of ["Strichliste","Veranstaltungen"]) {
      const link = nav.getByRole("link",{name,exact:true});
      const icon = link.locator("svg use");
      await page.waitForFunction(el => el.getBBox().width > 0,await icon.elementHandle());
      assert.equal(await link.locator(".area-caption").isVisible(),captionsVisible);
      if (!captionsVisible) {
        const box = await link.boundingBox();
        assert(box.width >= 44 && box.height >= 44);
      }
    }
  }
  try {
    const p=await open(390,844,true);
    const probe=await p.request.get(base+"/ui-fixtures.html");
    assert(probe.ok() && (await probe.text()).includes("lokale Testdaten"),"Abnahmekasse fehlt");
    await p.goto(base+"/strichliste.html");await checkAreaLinks(p,false);
    await p.emulateMedia({colorScheme:"light"});
    await p.goto(base+"/user.html");
    const picker = p.getByRole("switch",{name:"Dunkelmodus"});
    const theme = () => p.locator("html").getAttribute("data-theme");
    assert.equal(await picker.getAttribute("aria-checked"),"false");
    await p.emulateMedia({colorScheme:"dark"});
    await p.waitForSelector('html[data-theme="dark"]');
    await picker.click();
    const other = await p.context().newPage();
    await other.goto(base+"/updates/");
    assert.equal(await other.locator("html").getAttribute("data-theme"),"light");
    await other.getByRole("switch",{name:"Dunkelmodus"}).click();
    await p.waitForSelector('html[data-theme="dark"]');
    await p.reload();
    assert.equal(await picker.getAttribute("aria-checked"),"true");
    await p.emulateMedia({colorScheme:"light"});
    assert.equal(await theme(),"dark");
    await p.getByRole("button",{name:"Geräte-Farbschema verwenden"}).click();
    assert.equal(await theme(),"light");
    await other.close();
    await picker.click();
    console.log("Farbschema: Geräteeinstellung, manueller Wechsel, Neuladen und Abgleich mit der Update-Seite");
    await p.fill("#loginName","Marlene Hofmann");await p.fill("#loginPw","Falsch");await p.click("#btnLogin");
    await p.locator("#loginMsg").filter({hasText:"falsch"}).waitFor();
    await p.fill("#loginPw","Probe");await p.click("#btnLogin");await p.locator("#history .statement-entry").first().waitFor();
    const dock = p.locator("#accountNav > button:visible");
    assert.deepEqual(await dock.allTextContents(),["Verlauf","Getränke","Mehr"]);
    for (const button of await dock.all()) {
      const icon = button.locator('svg[aria-hidden="true"] use');
      await p.waitForFunction(el => el.getBBox().width > 0,await icon.elementHandle());
    }
    const balance=await p.textContent("#meBalance");
    await p.click('[aria-controls="shop"]');
    const item=p.locator("#buyProducts .drink-add").first();
    await item.click();await item.click();await p.locator("#buyProducts .drink-minus").first().click();
    assert.equal(await p.textContent("#buySum"),"1,50 €");
    await Promise.all([p.waitForResponse(r=>r.url().endsWith("/api/purchase")&&r.ok()),p.click("#btnBook")]);
    await p.click('[aria-controls="history"]');await p.waitForFunction(old=>document.querySelector("#meBalance").textContent!==old,balance);
    await p.click("#accountMore");await p.click('[aria-controls="emailPanel passwordPanel"]');await p.click("#emailPanel summary");
    await p.fill("#ownEmail","marlene+probe@example.test");await p.click("#emailForm button[type=submit]");
    await p.locator("#emailMessage").filter({hasText:/gespeichert/i}).waitFor();
    await p.click('[aria-controls="history"]');await p.click("#btnActiveMeal");
    const meal=p.locator(".active-meal-sheet[open]");
    await meal.locator("[data-name]").fill("Probeessen "+suffix);await meal.locator("[data-total]").fill("6");
    await meal.locator("[data-portions]").first().fill("2");
    await meal.locator("[data-file]").setInputFiles(path.resolve(__dirname,"../defaults/res/Bier_Foto.png"));
    await Promise.all([p.waitForResponse(r=>r.url().endsWith("/api/active-meals")&&r.request().method()==="POST"&&r.ok()),meal.locator("[data-submit]").click()]);
    await p.click("#btnLogout");await p.locator("#loginName").waitFor();
    console.log("Handy: Fehlanmeldung, Login, Getränkekauf, Menge, Saldo, E-Mail, Aktivenessen mit Beleg, Logout");

    for (const [state,count] of [["empty",0],["one",1],["worst",1001]]) {
      await p.setViewportSize({width:320,height:700});await p.goto(base+"/ui-fixtures.html?data="+state);
      const frame=p.frameLocator("iframe");await frame.locator("#meName").waitFor();
      if (!count) await frame.getByText("Noch keine Buchungen.").waitFor();
      if (count===1) assert.equal(await frame.locator(".statement-entry").count(),1);
      if (count>1) {
        const rows=frame.locator(".statement-entry");const before=await rows.count();
        assert(before<count);await frame.locator(".more-entries").first().click();assert((await rows.count())>before);
        const first=frame.locator("#history .statement-entry").first();
        const day=await first.locator("time").boundingBox(), money=await first.locator(".entry-money").boundingBox();
        assert(Math.abs(day.y-money.y)<12);
        assert(/\d\.\d{3}\.\d{3},\d\d €/.test(await frame.locator("#meBalance").textContent()));
        await frame.locator("html").evaluate(el=>el.style.fontSize="200%");
        const overflow=await frame.locator("html").evaluate(el=>el.scrollWidth-el.clientWidth);
        assert(overflow<=1,"200 % · Überbreite "+overflow);
        assert(await frame.locator("#accountNav > button").evaluateAll(buttons=>buttons.every(b=>b.scrollWidth<=b.clientWidth+1)),"Navigationsbeschriftungen überlappen");
      }
    }
    for (const [data,count] of [["empty",0],["one",1],["worst",4],["many",1001]]) {
      await p.goto(base+"/catalog-fixtures.html?data="+data);
      await p.locator(count ? ".catalog-item" : ".catalog-empty").first().waitFor();
      await p.locator("html").evaluate(el=>el.style.fontSize="200%");
      assert.equal(await p.locator(".catalog-item").count(),count);
      assert(await p.locator(".catalog-item").evaluateAll(rows=>rows.every(row=>row.scrollWidth<=row.clientWidth+1)));
      assert.equal(await p.locator("#productOrder").isDisabled(),count<2);
      if (count) {
        await p.locator(".catalog-item").last().click();
        await p.locator(".catalog-fields:visible [name=name]").waitFor();
      }
      await fit(p);
    }
    console.log("Grenzfälle: leer, ein Eintrag, 1.001 Buchungen, langer Text, Millionenbetrag, 320 px und 200 % Schrift");
    for (const [person,permissions] of [
      ["Jo",[]],["Lea Wagner",["secStock","debtMails","secGnu","secAudit"]],
      ["Paul Steiner",["secDash","secStock","secProd"]],["Đặng Thị Ngọc Hân",["secStock"]],
      ["Seán O'Brien-Ó Súilleabháin",["secBar","secStock"]]
    ]) {
      await p.goto(base+"/user.html");
      if (await p.locator("#btnLogout").isVisible()) await p.click("#btnLogout");
      await p.fill("#loginName",person);await p.fill("#loginPw","Probe");await p.click("#btnLogin");await p.locator("#meName").waitFor();
      await p.click("#accountMore");
      const groups=await p.locator("#moreViews button:visible").evaluateAll(els=>els.map(el=>el.getAttribute("aria-controls")));
      assert.deepEqual(groups.filter(v=>!v.includes("passwordPanel")),permissions);
      await p.keyboard.press("Escape");await p.click("#btnLogout");await p.locator("#loginName").waitFor();
    }
    console.log("Rollenzugänge: Mitglied, XXX, BW, KW und SW einzeln");
    await p.close();
    const k=await open(800,1280,true);
    let received;
    const loading = new Promise(resolve=>{received=resolve;});
    await k.route("**/api/tally/accounts",route=>received(route));
    await k.goto(base+"/strichliste.html");
    await k.getByText("Konten werden geladen …").waitFor();
    await checkAreaLinks(k,false);
    const delayed=await loading; await delayed.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Testkasse kurzzeitig nicht erreichbar."})});
    await k.getByText("Testkasse kurzzeitig nicht erreichbar.").waitFor();
    await k.unroute("**/api/tally/accounts");await k.getByRole("button",{name:"Erneut laden"}).click();
    await k.locator(".tile.prio").first().waitFor();
    assert.deepEqual(await k.locator("#names .event-group").evaluateAll(els=>els.map(e=>e.dataset.group)),["collective","priority","recent"]);
    await k.fill("#search","Nichtvorhandener Name");await k.locator(".empty-state").waitFor();
    await k.fill("#search","Marlene");await k.locator("#names .tile").first().click();await k.keyboard.press("Escape");
    await k.setViewportSize({width:1280,height:800});await k.click("#btnNew");
    await k.fill('#newAccount [name=name]',"Testkonto "+suffix);await k.fill('#newAccount [name=surname]',"Probe");
    await k.click("#newAccount [type=submit]");await k.locator("#sheet[open]").waitFor();
    await k.locator("#sheet .drink-add").first().click();await k.click("#btnReset");assert(await k.locator("#btnBook").isDisabled());
    await k.locator("#sheet .drink-add").first().click();
    await Promise.all([k.waitForResponse(r=>r.url().endsWith("/api/purchase")&&r.ok()),k.click("#btnBook")]);
    await k.getByRole("navigation",{name:"Kasse"}).getByRole("link",{name:"Veranstaltungen"}).click();
    await checkAreaLinks(k,false);await k.locator(".event-tile").filter({hasText:"Ankneipe"}).first().click();
    await k.locator("#prodGrid .drink-add").first().click();
    await Promise.all([k.waitForResponse(r=>r.url().endsWith("/api/purchase")&&r.ok()),k.click("#btnBook")]);
    await k.click("#btnBarCard");await k.locator("dialog[open] .bar-list input").first().waitFor();await k.keyboard.press("Escape");
    await k.goto(base+"/veranstaltung.html");await k.click("#btnNewEv");await k.fill("#evNewName","Sommerabend "+suffix);
    await k.click("#sheet button[type=submit]");await k.waitForURL("**/strichliste.html?event=*");
    await k.fill("#search","Marlene");await k.locator("#names .tile").first().click();await k.locator("#sheet .drink-add").first().click();
    await Promise.all([k.waitForResponse(r=>r.url().endsWith("/api/purchase")&&r.ok()),k.click("#btnBook")]);
    await fit(k);
    await k.goto(base+"/user.html");await k.fill("#loginName","Testkonto "+suffix);await k.fill("#loginPw","Probe");await k.click("#btnLogin");
    await k.click("#initialNotice summary");await k.click("#changeInitial");
    await k.fill("#pwOld","Probe");await k.fill("#pwNew","EigenesPasswort");await k.fill("#pwNew2","EigenesPasswort");await k.click("#btnPw");
    await k.locator("#initialNotice").waitFor({state:"hidden"});await k.click("#btnLogout");
    await k.fill("#loginPw","EigenesPasswort");await k.click("#btnLogin");await k.locator("#meName").waitFor();
    await k.close();console.log("Kiosk: Gruppierung, Suche, Kontoanlage, Rücksetzen, Buchung, Veranstaltung direkt und auf Personen, Getränkekarte");
    const d=await open(1440,900,false);
    await d.goto(base+"/strichliste.html");await checkAreaLinks(d,true);
    await d.goto(base+"/admin.html");await d.fill("#pin","246810");await d.locator("#pin").press("Enter");
    await d.locator("#dash .dash-choice").filter({hasText:"Marlene Hofmann"}).click();
    await d.locator("#dashDetail h3").filter({hasText:"Marlene Hofmann"}).waitFor();await fit(d);
    for(const tab of ["accounts","events","products","bar","stock","audit","gnucash","updates"]) {
      await d.click('[data-tab="'+tab+'"]');await d.locator("#tab-"+tab).waitFor();await fit(d);
    }
    await d.locator("#updateActive").filter({hasText:"v"}).waitFor();
    await d.click('[data-tab="stock"]');
    await d.setViewportSize({width:390,height:844});
    const f=d.locator(".stock-form");
    await f.locator('[name=area]').selectOption("drinks");
    await f.locator('[name=scope]').selectOption("event");await f.locator('[name=eventId]').selectOption({label:"Ankneipe"});
    await f.locator('[name=title]').fill("Zählprobe "+suffix);await f.locator('[data-add="Bier"]').click();await f.locator("[data-qty]").fill("6");
    await f.locator('[type=submit]').click();
    const record=d.locator(".stock-record").filter({hasText:"Zählprobe "+suffix}).first();
    await record.locator("[data-close-count]").click();await f.locator("[data-qty]").fill("4");await f.locator('[type=submit]').click();
    const booking=d.locator(".stock-record").filter({hasText:"Zählprobe "+suffix}).locator("[data-book]");
    await booking.waitFor(); assert((await booking.textContent()).includes("3,00"));
    d.once("dialog",dialog=>dialog.accept());await booking.click();await d.locator(".stock-record[open] .count-totals div").filter({hasText:/Bereits gebucht\s*3,00/}).first().waitFor();
    await record.locator("[data-edit]").click();
    await f.locator("[data-restock]").fill("2");await f.locator('[type=submit]').click();
    await d.locator("[data-view-count=archive][aria-pressed=true]").waitFor();
    await booking.waitFor();assert.match(await booking.innerText(),/3,00/);
    d.once("dialog",dialog=>dialog.accept());await booking.click();
    await d.locator(".stock-record[open] .count-totals div").filter({hasText:/Bereits gebucht\s*6,00/}).first().waitFor();
    await fit(d);
    const [countsPrint]=await Promise.all([d.waitForEvent("popup"),d.locator("#tab-stock [data-print-all]").click()]);
    await countsPrint.locator("section h2").first().waitFor();
    assert((await countsPrint.locator("body").innerText()).includes("Zählprobe "+suffix));
    await countsPrint.close();
    await d.setViewportSize({width:1440,height:900});
    await d.click('[data-tab="dash"]');
    const [tallyFile]=await Promise.all([d.waitForEvent("download"),d.getByRole("button",{name:"Strichliste (ODS)",exact:true}).click()]);
    assert.match(tallyFile.suggestedFilename(),/\.ods$/);assert.equal(await tallyFile.failure(),null);
    const [debtsPrint]=await Promise.all([d.waitForEvent("popup"),d.getByRole("button",{name:"Schuldenliste (PDF)",exact:true}).click()]);
    await debtsPrint.getByRole("heading",{name:"Getränkekasse – Offene Beträge"}).waitFor();assert((await debtsPrint.locator("tbody").innerText()).includes("Testkonto "+suffix));
    await debtsPrint.close();
    await d.goto(base+"/updates/");await d.locator("#active").filter({hasText:"in Betrieb"}).waitFor();await fit(d);
    await d.goto(base+"/admin.html");await d.setViewportSize({width:360,height:780});
    for(const tab of ["accounts","events","products","stock","bar","gnucash","audit","dash","updates"]) {
      await d.selectOption("#adminSection",tab);await fit(d);
      const currentIcon = await d.locator('[data-tab="'+tab+'"] use').getAttribute("xlink:href");
      assert.equal(await d.locator(".section-picker use").getAttribute("xlink:href"),currentIcon);
    }
    await d.selectOption("#adminSection","products");
    await d.click("#btnAddProd");
    const fields=d.locator(".catalog-fields:visible"), drink="Schorle "+suffix;
    await fields.getByLabel("Produktname").fill(drink);
    await fields.getByLabel("Preis (€)").fill("2,30");
    await fields.getByLabel("Auf Papier-Strichliste").check();
    await d.click("#productOrder");const orderDialog=d.locator("dialog[open]");
    await orderDialog.getByLabel("Produkt",{exact:true}).selectOption({label:drink});
    await orderDialog.getByLabel("Neue Position").selectOption({value:"0"});
    await orderDialog.getByRole("button",{name:"Verschieben"}).click();
    await d.click("#btnSaveProd");await d.locator(".catalog-save").waitFor({state:"hidden"});
    const stored=(await (await d.request.get(base+"/api/products")).json())[0];
    assert.equal(stored.name,drink);assert.equal(stored.price,2.3);assert(stored.tally);
    await d.selectOption("#adminSection","dash");await d.fill("#dashSearch","Marlene");await d.click("#dash > details > summary");await d.locator("#dash .semgroup").first().waitFor();
    await d.close();console.log("Verwaltung: alle neun Bereiche, Desktop-Detail und Handywahl, Vor-/Nachzählung und Differenzbuchung, separate Update-Seite");
    assert.deepEqual(faults,[]);
  } finally {await browser.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
