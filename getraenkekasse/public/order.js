"use strict";

// Eine Bedienung für persönliche Käufe, Strichlisten und Direktveranstaltungen.
function mountOrder({grid, sum, tally, reset, submit, book, onBooked, onRejected}) {
  const quantities = new Map();
  const tiles = new Map();
  let busy = false;
  function update() {
    let cents = 0, total = 0;
    for (const [name, tile] of tiles) {
      const qty = quantities.get(name) || 0;
      cents += Math.round(tile.product.price * 100) * qty;
      total += qty;
      tile.add.disabled = busy;
      tile.remove.disabled = busy || !qty;
      tile.badge.hidden = !qty;
      tile.badge.textContent = qty;
      tile.add.setAttribute("aria-label", name + " hinzufügen, " + BW.money(tile.product.price) + ", ausgewählt " + qty);
    }
    sum.textContent = BW.money(cents / 100);
    if (tally) {
      const groups = Math.min(Math.ceil(total / 5), 8);
      let marks = "";
      for (let i = 0; i < groups; i++) {
        const count = Math.min(total - i * 5, 5);
        marks += '<span aria-hidden="true" class="g ' + (count === 5 ? "full" : "") + '">' + "<i></i>".repeat(Math.min(count, 4)) + "</span>";
      }
      tally.innerHTML = marks;
      const caption = document.createElement("span");
      caption.className = "muted";
      caption.textContent = total ? total + (total === 1 ? " Strich" : " Striche") : "Noch keine Striche";
      tally.append(caption);
    }
    reset.disabled = submit.disabled = busy || !total;
    submit.textContent = busy ? "Wird gebucht …" : "Buchen";
  }

  function setProducts(products) {
    const catalog = new Map(products.map(p => [p.name, p]));
    for (const name of quantities.keys()) {
      if (!catalog.has(name) || catalog.get(name).price !== tiles.get(name)?.product.price || catalog.get(name).recipeId !== tiles.get(name)?.product.recipeId) {
        quantities.delete(name);
        BW.toast("Das Angebot hat sich geändert. Bitte die Auswahl prüfen.");
      }
    }
    const same = products.length === tiles.size && products.every((p, i) => {
      const tile = tiles.get(p.name);
      return tile && tile.element === grid.children[i] && tile.product.price === p.price && tile.product.recipeId === p.recipeId && tile.product.image === p.image;
    });
    if (!same) {
      grid.replaceChildren();
      tiles.clear();
      for (const product of products) {
        const {name, price} = product;
        const element = document.createElement("div");
        element.className = "drink-tile";
        element.innerHTML = '<button type="button" class="drink-add"><span class="drink-picture"></span><span class="drink-name"></span><span class="drink-price"></span><span class="count" hidden></span></button><button type="button" class="drink-minus">−</button>';
        const [add, remove] = element.querySelectorAll("button");
        const picture = element.querySelector(".drink-picture");
        if (product.image) {
          const img = document.createElement("img");
          img.alt = ""; img.src = "/assets/res/" + encodeURIComponent(product.image);
          picture.append(img);
        } else {
          picture.setAttribute("aria-hidden", "true");
          picture.textContent = "🍹";
        }
        element.querySelector(".drink-name").textContent = wrapName(name);
        element.querySelector(".drink-price").textContent = BW.money(price);
        remove.setAttribute("aria-label", "Einen Strich für " + name + " entfernen");
        add.onclick = () => { quantities.set(name, (quantities.get(name) || 0) + 1); update(); };
        remove.onclick = () => {
          const qty = quantities.get(name) - 1;
          if (qty) quantities.set(name, qty); else quantities.delete(name);
          update();
          if (!qty) add.focus({preventScroll:true});
        };
        tiles.set(name, {element, product, add, remove, badge:element.querySelector(".count")});
        grid.append(element);
      }
    }
    update();
  }

  function clear() { quantities.clear(); update(); }
  reset.onclick = clear;
  submit.onclick = async () => {
    if (busy || !quantities.size) return;
    const items = Array.from(quantities, ([name, qty]) => ({name, qty, price:tiles.get(name).product.price, recipeId:tiles.get(name).product.recipeId}));
    busy = true; update();
    try {
      await book(items);
    } catch (error) {
      BW.toast(error.message);
      if (onRejected) await onRejected().catch(e => BW.toast(e.message));
      return;
    } finally {
      busy = false; update();
    }
    clear();
    try { await onBooked(); } catch (error) { BW.toast("Gebucht. " + error.message); }
  };
  update();
  return {setProducts, clear, get busy() { return busy; }, get selected() { return quantities.size > 0; }};
}
