"use strict";
const os = require("node:os");
const net = require("node:net");

function lanConfig(host, interfaces) {
  const devices = interfaces || (host === "127.0.0.1" ? {} : os.networkInterfaces());
  const local = Object.values(devices).flat().find(i => i.family === "IPv4" && i.address === host);
  if (!net.isIPv4(host) || !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host))
    throw new Error("host muss 127.0.0.1 oder die private IPv4-Adresse der LAN-Schnittstelle sein.");
  if (!local && host !== "127.0.0.1") throw new Error("Die konfigurierte LAN-Adresse gehört zu keiner lokalen Schnittstelle.");
  const mask = local?.netmask || "255.0.0.0";
  const num = ip => ip.split(".").reduce((n, octet) => (n << 8) | Number(octet), 0);
  const network = num(host) & num(mask);
  return function localOnly(req, res, next) {
    const peer = req.socket.remoteAddress || "";
    const authority = req.headers.host || "";
    const name = authority.split(":")[0].toLowerCase();
    const origin = req.headers.origin;
    if (!net.isIPv4(peer) || (num(peer) & num(mask)) !== network ||
        !(name === host || (host === "127.0.0.1" && name === "localhost")) ||
        (origin && origin !== "http://" + authority && origin !== "https://" + authority)) {
      return res.status(403).send("Nur im konfigurierten lokalen Netz erreichbar.");
    }
    next();
  };
}
module.exports = { lanConfig };
