"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const {PDFDocument, PageSizes, rgb} = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const {categories} = require("./public/bar-types");
const {linesFor} = require("./pdf-text");

const black = rgb(0.05,0.05,0.05);
const [width,height] = PageSizes.A4;
const rule = (page,x1,y1,x2,y2,thickness=1) => page.drawLine({start:{x:x1,y:height-y1},end:{x:x2,y:height-y2},color:black,thickness});
const write = (page,text,x,y,font,size) => page.drawText(text,{x,y:height-y,size,font,color:black});
const money = n => n.toLocaleString("de-DE",{minimumFractionDigits:Number.isInteger(n)?0:2,maximumFractionDigits:2})+" €";

function drawGlass(page, type, x, top, scale=1) {
  const dimensions = {cocktail:[30,34,10],longdrink:[20,42,8],shot:[18,22,6]};
  const [w,h,b] = dimensions[type];
  x += (30-w)*scale/2;
  const d = "M 0 2 Q "+w/2+" -1 "+w+" 2 L "+(w/2+b)+" "+h+" Q "+w/2+" "+(h+3)+" "+(w/2-b)+" "+h+" Z M 0 2 Q "+w/2+" 5 "+w+" 2";
  const details = type==="cocktail" ? " M 2 11 Q 7 9 9 15 Q 14 10 16 16 Q 21 10 24 14 Q 26 10 29 11 M 9 15 L 11 31 M 16 16 L 16 31 M 24 14 L 22 31" :
    type==="shot" ? " M 2 15 Q 9 18 16 15" : "";
  page.drawSvgPath(d+details,{x,y:height-top,scale,borderColor:black,borderWidth:1.25});
}

async function menuPdf(kind, recipes, eventName="") {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regular,bold] = await Promise.all(["DejaVuSerif.ttf","DejaVuSerif-Bold.ttf"].map(async file =>
    doc.embedFont(await fs.readFile(path.join(__dirname,"fonts",file)),{subset:true})));
  const mix = kind === "mixliste";
  const title = mix ? "Mixliste" : "Preisliste";
  doc.setTitle(eventName ? title+" · "+eventName : title);
  const columns = mix ? [["cocktail","shot"],["longdrink","soft"]] : [["cocktail","longdrink","soft","shot"]];
  const groups = columns.map(side => side.filter(key => recipes.some(r=>r.category===key))).filter(side=>side.length);
  const eventLines = eventName ? linesFor(eventName,regular,12,width-90) : [];
  const legendTop = 74 + eventLines.length*15;
  const top = legendTop + (mix?66:22);
  const bottom = height-32;
  const pages = [];
  function pageAt(i) {
    if (pages[i]) return pages[i];
    const p = doc.addPage(PageSizes.A4);
    pages.push(p);
    p.drawRectangle({x:11,y:11,width:width-22,height:height-22,borderWidth:1.9,borderColor:black});
    const titleWidth = bold.widthOfTextAtSize(title,50);
    rule(p,27,43,(width-titleWidth)/2-14,43,1.5);
    rule(p,(width+titleWidth)/2+14,43,width-27,43,1.5);
    write(p,title,(width-titleWidth)/2,57,bold,50);
    eventLines.forEach((s,j)=>write(p,s,(width-regular.widthOfTextAtSize(s,12))/2,76+15*j,regular,12));
    if (mix) {
      p.drawRectangle({x:30,y:height-legendTop-42,width:width-60,height:42,borderWidth:1,borderColor:black});
      let x=44;
      for (const [glass,label] of [["cocktail","Cocktailglas (IKEA)"],["longdrink","Longdrinkglas"],["shot","Shotglas"]]) {
        drawGlass(p,glass,x,legendTop+6,0.70);
        write(p,label,x+27,legendTop+26,regular,12);
        x += glass==="cocktail"?199:174;
      }
    }
    if (groups.length===2) rule(p,width/2,top-2,width/2,bottom,0.85);
    return p;
  }
  groups.forEach((side,index) => {
    const x = groups.length===1 ? 64 : index===0 ? 28 : width/2+15;
    const colWidth = groups.length===1 ? width-128 : width/2-43;
    let pn=0, y=top;
    const page=()=>pageAt(pn);
    for (const key of side) {
      const drinks = recipes.filter(r=>r.category===key);
      const samePrice = !mix && drinks.every(r=>r.price===drinks[0].price);
      function heading() {
        write(page(), categories[key],x,y+21,bold,22);
        if (samePrice) {
          const value = money(drinks[0].price);
          write(page(),value,x+colWidth-bold.widthOfTextAtSize(value,21),y+21,bold,21);
        }
        rule(page(),x,y+29,x+colWidth,y+29,1.5);
        y+=46;
      }
      function next() { pn++; y=top; heading(); }
      let first=true;
      for (const r of drinks) {
        const nameX=x+(mix?41:2), rightEdge=x+colWidth;
        const priceText=!mix && !samePrice?money(r.price):"";
        const titleWidth=rightEdge-nameX-(priceText?bold.widthOfTextAtSize(priceText,14)+10:0);
        const titles=linesFor(r.name,bold,16,titleWidth);
        const amountWidth = Math.min(75,Math.max(26,...r.ingredients.map(i=>regular.widthOfTextAtSize(i.amount,12))))+7;
        const rows=[];
        if (mix) for (const ingredient of r.ingredients) {
          const amounts=linesFor(ingredient.amount,regular,12,amountWidth-5);
          const names=linesFor(ingredient.name,regular,12,rightEdge-nameX-amountWidth);
          for (let i=0;i<Math.max(amounts.length,names.length);i++) rows.push([amounts[i]||"",names[i]||""]);
        }
        const iconHeight = !mix ? 0 : {shot:24, cocktail:35, longdrink:43}[r.glass];
        const bodyHeight = Math.max(iconHeight,titles.length*19+rows.length*15)+(mix?12:16);
        if (first) {
          if (y+46+Math.min(bodyHeight,bottom-top-46)>bottom) {pn++;y=top;}
          heading(); first=false;
        } else if (y+Math.min(bodyHeight,bottom-top-46)>bottom) next();
        function itemHead(continued) {
          const here=page();
          if (mix) drawGlass(here,r.glass,x+1,y+2,r.glass==="shot"?0.86:0.95);
          titles.forEach((s,i)=>write(here,s,nameX,y+14+19*i,bold,16));
          if (priceText) write(here,priceText,rightEdge-bold.widthOfTextAtSize(priceText,14),y+14,bold,14);
          y+=titles.length*19;
          if (continued) {write(here,"Fortsetzung",nameX,y+10,regular,10);y+=14;}
        }
        const start=y;
        itemHead(false);
        for (const [amount,name] of rows) {
          if (y+15>bottom) {next();itemHead(true);}
          if (amount) write(page(),amount,nameX,y+11,regular,12);
          if (name) write(page(),name,nameX+amountWidth,y+11,regular,12);
          y+=15;
        }
        if (mix && !rows.length) y=Math.max(y,start+iconHeight);
        y+=mix?12:16;
      }
      y+=8;
    }
  });
  if (pages.length>1) pages.forEach((p,i)=>write(p,(i+1)+" / "+pages.length,width/2-12,height-18,regular,8));
  return doc.save();
}
module.exports = {menuPdf};
