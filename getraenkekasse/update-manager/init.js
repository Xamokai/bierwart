// Bootstrap a pristine Git clone. For existing installations use the documented migration.
"use strict";
const fs=require("node:fs");
const path=require("node:path");
const root=path.dirname(__dirname);
for (const item of ["data","assets","config.json",".bierwart"]) {
  if(fs.existsSync(path.join(root,item))) {
    console.error("Es gibt bereits Kassendaten oder eine Konfiguration. Für eine Übernahme die Update-Anleitung verwenden.");
    process.exit(1);
  }
}
fs.mkdirSync(path.join(root,"data"),{mode:0o700});
fs.mkdirSync(path.join(root,"assets","receipts"),{recursive:true});
fs.cpSync(path.join(root,"defaults","res"),path.join(root,"assets","res"),{recursive:true});
fs.copyFileSync(path.join(root,"defaults","db.json"),path.join(root,"data","db.json"));
fs.copyFileSync(path.join(root,"defaults","config.json"),path.join(root,"config.json"));
console.log("Leere Kasse eingerichtet. Für den LAN-Betrieb die Adresse in config.json eintragen.");
