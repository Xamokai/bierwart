"use strict";
const os = require("node:os");
const net = require("node:net");
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs/promises");
const path = require("node:path");
const {once} = require("node:events");

function lanConfig(host, interfaces, hostname) {
  const devices = interfaces || (host === "127.0.0.1" ? {} : os.networkInterfaces());
  const local = Object.values(devices).flat().find(i => i.family === "IPv4" && i.address === host);
  if (!net.isIPv4(host) || !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host))
    throw new Error("host muss 127.0.0.1 oder die private IPv4-Adresse der LAN-Schnittstelle sein.");
  if (!local && host !== "127.0.0.1") throw new Error("Die konfigurierte LAN-Adresse gehört zu keiner lokalen Schnittstelle.");
  if (hostname !== undefined && (typeof hostname !== "string" || !hostname.length || hostname.length > 253 ||
      !hostname.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))))
    throw new Error("https.hostname muss ein einzelner DNS-Name sein, z. B. bw.uhaus.");
  const names = new Set([host]);
  if (host === "127.0.0.1") names.add("localhost");
  if (hostname) names.add(hostname.toLowerCase());
  const mask = local?.netmask || "255.0.0.0";
  const num = ip => ip.split(".").reduce((n, octet) => (n << 8) | Number(octet), 0);
  const network = num(host) & num(mask);
  return function localOnly(req, res, next) {
    const peer = req.socket.remoteAddress || "";
    const authority = req.headers.host || "";
    const name = authority.replace(/:\d+$/, "").toLowerCase();
    const origin = req.headers.origin;
    if (!net.isIPv4(peer) || (num(peer) & num(mask)) !== network ||
        !names.has(name) || (origin && origin !== "https://" + authority &&
          (req.socket.encrypted || origin !== "http://" + authority))) {
      return res.status(403).send("Nur im konfigurierten lokalen Netz erreichbar.");
    }
    next();
  };
}

async function listenLan(app, host, port, tls, root) {
  const endpoints = [[http.createServer(app), port]];
  if (tls != null) {
    if (typeof tls.certFile !== "string" || !tls.certFile.trim() || typeof tls.keyFile !== "string" || !tls.keyFile.trim())
      throw new Error("Für HTTPS werden https.certFile und https.keyFile benötigt.");
    const tlsPort = tls.port ?? 443;
    if (!Number.isInteger(tlsPort) || tlsPort < 1 || tlsPort > 65535 || tlsPort === port)
      throw new Error("Der HTTPS-Port muss zwischen 1 und 65535 liegen und sich vom HTTP-Port unterscheiden.");
    const [cert,key] = await Promise.all([tls.certFile,tls.keyFile].map(file => fs.readFile(path.resolve(root,file))));
    endpoints.push([https.createServer({cert,key,minVersion:"TLSv1.2"},app), tlsPort]);
  }
  try {
    for (const [server,listenPort] of endpoints) {
      server.listen(listenPort,host);
      await once(server,"listening");
    }
  } catch (err) {
    for (const [server] of endpoints) if (server.listening) server.close();
    throw err;
  }
  return endpoints.map(([server]) => server);
}

function logListeners(servers) {
  for (const server of servers) {
    const {address,port} = server.address();
    console.log(`Getränkekasse: ${server instanceof https.Server ? "https" : "http"}://${address}:${port}`);
  }
}

module.exports = {lanConfig,listenLan,logListeners};
