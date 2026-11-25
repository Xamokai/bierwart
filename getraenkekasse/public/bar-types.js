"use strict";

const BarTypes = {
  categories: {cocktail:"Cocktails", shot:"Shots", longdrink:"Longdrinks", soft:"Alkoholfrei"},
  glasses: {cocktail:"Cocktailglas (IKEA)", longdrink:"Longdrinkglas", shot:"Shotglas"},
  defaultGlass: {cocktail:"cocktail", shot:"shot", longdrink:"longdrink", soft:"cocktail"}
};
if (typeof module !== "undefined") module.exports = BarTypes;
