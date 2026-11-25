"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const {execFile} = require("node:child_process");
const {promisify} = require("node:util");
const exec = promisify(execFile);
const tagPattern = /^v(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const hashPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const mutable = new Set(["assets","data","config.json","node_modules",".git",".bierwart","update-manager"]);

function repoAddress(input) {
  let url;
  try { url = new URL(input); } catch {}
  if (!url || url.protocol !== "https:" || !url.hostname || url.pathname === "/" ||
      url.username || url.password || url.search || url.hash || /[\s\\]/.test(input) || input.length > 2048)
    throw Error("Bitte die HTTPS-Klonadresse des Git-Repositories ohne Zugangsdaten eingeben.");
  return url.href.replace(/\/$/, "");
}

async function git(args, cwd) {
  const {stdout} = await exec("git", ["-c","http.followRedirects=false","-c","core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null"), ...args],
    {cwd, timeout:120000, maxBuffer:12*1024*1024, env:{...process.env, GIT_ALLOW_PROTOCOL:"https", GIT_TERMINAL_PROMPT:"0", GCM_INTERACTIVE:"never"}});
  return stdout.trimEnd();
}

function newestFirst(a,b) {
  const x = a.tag.slice(1).split(".").map(Number), y = b.tag.slice(1).split(".").map(Number);
  return y[0]-x[0] || y[1]-x[1] || y[2]-x[2];
}

async function listTags(repo, cwd) {
  let raw;
  try { raw = await git(["ls-remote","--tags","--",repo],cwd); }
  catch { throw Error("Git konnte das Repository nicht lesen. Klonadresse und Lesezugriff des Serverkontos prüfen."); }
  const tags = new Map();
  for (const line of raw.split("\n")) {
    const [oid, ref] = line.split("\t");
    if (!hashPattern.test(oid) || !ref?.startsWith("refs/tags/")) continue;
    const tag = ref.slice(10).replace(/\^\{\}$/, "");
    if (!tagPattern.test(tag)) continue;
    const entry = tags.get(tag) || {tag};
    entry[ref.endsWith("^{}") ? "peeled" : "oid"] = oid;
    tags.set(tag,entry);
  }
  return [...tags.values()].filter(t=>t.oid).map(t=>({repo,tag:t.tag,oid:t.oid,commit:t.peeled || t.oid})).sort(newestFirst);
}

async function verifyCheckout(entry, cwd, signers) {
  await git(["init","-q"],cwd);
  const ref = "refs/tags/" + entry.tag;
  try { await git(["fetch","--depth=1","--no-tags","--no-recurse-submodules","--",entry.repo,ref+":"+ref],cwd); }
  catch { throw Error("Download fehlgeschlagen. Die bisherige Version läuft weiter."); }
  if (await git(["rev-parse",ref],cwd) !== entry.oid || await git(["rev-parse",ref+"^{}"],cwd) !== entry.commit)
    throw Error("Der Tag hat sich geändert. Bitte erneut nach Updates suchen.");
  const tagObject = await git(["cat-file","-p",ref],cwd);
  if (!tagObject.includes("\ntag "+entry.tag+"\n") || !tagObject.endsWith("-----END SSH SIGNATURE-----"))
    throw Error("Dieser Tag trägt keine passende SSH-Signatur.");
  try {
    await git(["-c","gpg.format=ssh","-c","gpg.ssh.allowedSignersFile="+signers,"verify-tag",ref],cwd);
  } catch { throw Error("Die Release-Signatur gehört zu keinem freigegebenen Schlüssel oder ist ungültig."); }
  const tree = await git(["ls-tree","-rz",entry.commit],cwd);
  for (const record of tree.split("\0").filter(Boolean)) {
    if (!/^100(644|755) blob /.test(record)) throw Error("Das Release enthält einen Dateilink oder ein Untermodul.");
  }
  await git(["checkout","--quiet","--detach",entry.commit],cwd);
}

async function prepare(entry, root, storage, signers) {
  const scratch = await fs.mkdtemp(path.join(storage,"fetch-"));
  try {
    await verifyCheckout(entry,scratch,signers);
    const nested = path.join(scratch,"getraenkekasse");
    const source = (await fs.stat(nested).catch(()=>null))?.isDirectory() ? nested : scratch;
    const pkg = JSON.parse(await fs.readFile(path.join(source,"package.json"),"utf8"));
    const format = pkg.bierwartDataFormat ?? (pkg.version === "1.10.1" ? 1 : null);
    if (pkg.name !== "getraenkekasse" || "v"+pkg.version !== entry.tag || format !== 1)
      throw Error("Paketname, Version oder Datenformat passen nicht zu dieser Kasse.");
    for (const file of ["server.js","lan.js","public/strichliste.html","package-lock.json"])
      if (!(await fs.stat(path.join(source,file))).isFile()) throw Error("Im Release fehlen Programmdateien.");
    const slot = await fs.mkdtemp(path.join(storage,"build-"));
    try {
      for (const file of await fs.readdir(source)) {
        if (!mutable.has(file) && !file.startsWith(".")) await fs.cp(path.join(source,file),path.join(slot,file),{recursive:true});
      }
      const lock = await fs.readFile(path.join(slot,"package-lock.json"),"utf8");
      // A version bump changes the package metadata, even with identical dependencies.
      const dependencies = raw => {
        const data = JSON.parse(raw);
        const packages = {...data.packages}; delete packages[""];
        return JSON.stringify([data.lockfileVersion,packages,data.dependencies || {}]);
      };
      const basePkg=JSON.parse(await fs.readFile(path.join(root,"package.json"),"utf8"));
      if (dependencies(lock) === dependencies(await fs.readFile(path.join(root,"package-lock.json"),"utf8")) &&
          JSON.stringify(pkg.dependencies) === JSON.stringify(basePkg.dependencies)) {
        await fs.symlink(path.join(root,"node_modules"),path.join(slot,"node_modules"),"junction");
      } else {
        const args = ["ci","--ignore-scripts","--no-audit","--no-fund"];
        const npm = process.env.npm_execpath;
        await exec(npm ? process.execPath : "npm", npm ? [npm,...args] : args,{cwd:slot,timeout:240000});
      }
      for (const dir of ["data","assets"]) await fs.symlink(path.join(root,dir),path.join(slot,dir),"junction");
      // If a previous preparation was interrupted before registration, rebuild its slot.
      const installed=path.join(storage,entry.oid);
      await fs.rm(installed,{recursive:true,force:true});
      await fs.rename(slot,installed);
    } finally { await fs.rm(slot,{recursive:true,force:true}); }
  } finally { await fs.rm(scratch,{recursive:true,force:true}); }
}

module.exports = {repoAddress,listTags,prepare,newestFirst,hashPattern};
