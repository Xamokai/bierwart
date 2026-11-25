"use strict";

const {categories, glasses, defaultGlass} = require("./public/bar-types");
const {visibleEvent, eventLabel, activeDrinks} = require("./event-mode");
const {menuPdf} = require("./bar-pdf");

function initialRecipes() {
  const recipes = [
    ["plutonium","Plutonium","cocktail",[["4 cl","Gin"],["2 cl","Vodka"],["3 cl","Zitronensaft"],["2 cl","Apricot Brandy"],["1 cl","Blue Curaçao"],["","Maracujasaft"]]],
    ["uhu","Uhu-Fruchtsaft","cocktail",[["4 cl","Vodka"],["2 cl","Apricot Brandy"],["2 cl","Pepino Peach"],["2 cl","Eckes"],["2 cl","Cointreau"],["1 cl","Grenadine"],["","Maracujasaft"],["","Orangensaft"]]],
    ["beach","Sex on the Beach","cocktail",[["3 cl","Vodka"],["3 cl","Pepino Peach"],["2 cl","Cranberrysirup"],["1 cl","Zitronensaft"],["","Orangensaft"]]],
    ["luft","Berliner Luft","shot",[]], ["jaeger","Jägermeister","shot",[]], ["brain","Brain-Shot","shot",[]],
    ["gintonic","Gin Tonic","longdrink",[["4 cl","Gin"],["","Tonic Water"]]],
    ["cuba","Cuba Libre","longdrink",[["5 cl","Havana Club"],["","Cola"],["1","Limette (Achtel)"]]],
    ["whiskey","Whiskey Cola","longdrink",[["","Whiskey (Bourbon/Scotch)"],["","Cola"]]],
    ["ipanema","Ipanema","soft",[["4 cl","Maracujasaft"],["10 cl","Ginger Ale"],["1–2 TL","Brauner Zucker"],["1","Limette"]]],
    ["borabora","Bora Bora","soft",[["10 cl","Ananassaft"],["6 cl","Maracujasaft"],["1 cl","Grenadine"],["1 cl","Zitronensaft"]]],
    ["shirley","Shirley Temple","soft",[["50 %","Ginger Ale"],["50 %","Zitronenlimonade"],["Schuss","Grenadine"]]]
  ];
  return recipes.map(([id,name,category,rows]) => ({
    id, name, category, glass:defaultGlass[category], price:{cocktail:5, longdrink:4, soft:3, shot:1}[category],
    ingredients:rows.map(([amount,name]) => ({amount,name})), version:1
  }));
}
const sameName = (a,b) => a.trim().normalize("NFC").toLocaleLowerCase("de") === b.trim().normalize("NFC").toLocaleLowerCase("de");
function eventRecipes(db, event) {
  const ids = new Set(event?.barRecipes || []);
  return db.barRecipes.filter(r => ids.has(r.id));
}
function listedRecipe(db, name, event) {
  return db.barRecipes.some(r => sameName(r.name,name) && (event ? event.barRecipes?.includes(r.id) :
    db.accounts.some(e => visibleEvent(e) && e.barRecipes?.includes(r.id))));
}
const offer = r => ({recipeId:r.id, name:r.name, price:r.price, category:r.category});
function cleanString(s, max, optional=false) {
  return typeof s === "string" && (optional || !!s.trim()) && s.trim().length <= max && !/[\x00-\x1f\x7f]/.test(s);
}
function parseRecipe(input, parsePrice) {
  const {name, category, glass, ingredients} = input;
  const price = parsePrice(input.price);
  if (!cleanString(name,80) || !Object.hasOwn(categories,category) || !Object.hasOwn(glasses,glass) ||
      !Number.isFinite(price) || price <= 0 || price > 9999.99 || !Array.isArray(ingredients) || ingredients.length > 24 ||
      ingredients.some(i => !i || !cleanString(i.name,100) || !cleanString(i.amount,24,true))) return null;
  return {name:name.trim(), category, glass, price, ingredients:ingredients.map(i => ({amount:i.amount.trim(),name:i.name.trim()}))};
}

function mountBar(app,{getDB, allow, optionalUser, saveDB, newId, parsePrice, loadProducts, addAudit}) {
  const guard = allow("schnapswart");
  const catalog = "/api/bar/recipes";
  const eventPath = "/api/events/:id/bar";
  const missing = res => res.status(404).json({error:"Rezept oder Veranstaltung nicht mehr verfügbar."});
  const conflict = res => res.status(409).json({error:"Das Rezept wurde inzwischen geändert. Bitte neu öffnen."});
  const nameInUse = (db,event,name) => [...loadProducts(),...activeDrinks(db.settings),...activeDrinks(event)].some(p => sameName(p.name,name));
  function selected(db, ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 200 || ids.some(id => typeof id !== "string")) return null;
    const set = new Set(ids);
    const list = db.barRecipes.filter(r => set.has(r.id));
    return list.length === set.size ? list : null;
  }
  function record(req, action, obj, before, after) {
    addAudit(req,"bar."+action, action.startsWith("event") ? "Getränkekarte geändert" : "Rezeptkatalog geändert",
      {type:obj.isEvent?"event":"recipe",id:obj.id,label:obj.name},before,after, null,
      {type:"tally", name:"Veranstaltungsseite"});
  }
  app.get("/api/bar/offer", (req,res) => res.json(getDB().barRecipes.map(offer)));
  app.get(catalog,guard,(req,res) => res.json(getDB().barRecipes));
  function store(req,res) {
    const db = getDB();
    const recipe = parseRecipe(req.body || {},parsePrice);
    if (!recipe) return res.status(400).json({error:"Name, Kategorie, Glas, gültigen Preis und Zutaten prüfen (höchstens 24 Zutaten)."});
    const old = req.params.id && db.barRecipes.find(r => r.id === req.params.id);
    if (req.params.id && !old) return missing(res);
    if (old && old.version !== req.body.version) return conflict(res);
    if (db.barRecipes.some(r => r !== old && sameName(r.name,recipe.name)) ||
        (old && db.accounts.some(e => visibleEvent(e) && e.barRecipes?.includes(old.id) && nameInUse(db,e,recipe.name)))) {
      return res.status(409).json({error:"Dieser Getränkename ist bereits vergeben."});
    }
    const entry = {...recipe,id:old ? old.id : newId(),version:old ? old.version+1 : 1};
    if (old) db.barRecipes[db.barRecipes.indexOf(old)] = entry;
    else db.barRecipes.push(entry);
    record(req,"recipe_saved",entry,old || null,entry);
    saveDB(db); res.json(entry);
  }
  app.post(catalog,guard,store);
  app.put(catalog+"/:id",guard,store);
  app.delete(catalog+"/:id",guard,(req,res) => {
    const db = getDB(), entry = db.barRecipes.find(r => r.id === req.params.id);
    if (!entry) return missing(res);
    if (entry.version !== req.body?.version) return conflict(res);
    db.barRecipes = db.barRecipes.filter(r => r !== entry);
    for (const ev of db.accounts) if (ev.barRecipes?.includes(entry.id)) ev.barRecipes = ev.barRecipes.filter(id => id !== entry.id);
    record(req,"recipe_deleted",entry,entry,null);
    saveDB(db); res.json({ok:true});
  });

  function changeEvent(remove) {
    return (req,res) => {
      const db = getDB(), ev = db.accounts.find(e => e.id === req.params.id && visibleEvent(e));
      if (!ev) return missing(res);
      const recipes = selected(db,req.body?.ids);
      if (!recipes) return res.status(400).json({error:"Bitte verfügbare Getränke auswählen."});
      const ids = new Set(ev.barRecipes || []), before = [...ids];
      for (const r of recipes) {
        if (remove) ids.delete(r.id);
        else {
          if (nameInUse(db,ev,r.name)) return res.status(409).json({error:"„"+r.name+"“ ist bei dieser Veranstaltung schon als anderes Getränk verfügbar."});
          ids.add(r.id);
        }
      }
      if (ids.size !== before.length) {
        ev.barRecipes = [...ids];
        record(req,"event_changed",ev,before,ev.barRecipes);
        saveDB(db);
      }
      res.json({ok:true});
    };
  }
  app.post(eventPath,optionalUser,changeEvent(false));
  app.post(eventPath+"/remove",guard,changeEvent(true));
  async function print(req,res) {
    const db = getDB();
    const kind = req.params.kind;
    if (!["mixliste","preisliste"].includes(kind)) return res.status(400).json({error:"Unbekannte Druckansicht."});
    let recipes, title = "";
    if (req.params.id) {
      const event = db.accounts.find(e => e.id === req.params.id && visibleEvent(e));
      if (!event) return missing(res);
      recipes = eventRecipes(db,event); title = eventLabel(event);
    } else {
      recipes = selected(db,req.body?.ids);
    }
    if (!recipes?.length) return res.status(400).json({error:"Für diese Karte sind keine Getränke ausgewählt."});
    const bytes = await menuPdf(kind,recipes,title);
    res.type("application/pdf").attachment(kind+".pdf").send(Buffer.from(bytes));
  }
  app.post("/api/bar/print/:kind",guard,print);
  app.get(eventPath+"/print/:kind",print);
}
module.exports = {initialRecipes, eventRecipes, listedRecipe, offer, mountBar};
