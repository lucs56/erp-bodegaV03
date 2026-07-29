import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeMonthlyPurchasePlan,
  parseMonthlyPurchaseSheets,
} from "../lib/monthly-purchases.ts";

test("interpreta el estimado y recalcula la cantidad mensual a comprar", () => {
  const result = parseMonthlyPurchaseSheets({
    ESTIMADO: [
      ["canal", "TOTAL BODEGA"],
      ["CÓDIGO", "VARIEDAD", "PRESENTACIÓN", 46235, 46266],
      [],
      ["", "", "", "", "", "total cajas", "total botellas", "botella", "tapon", "tapa", "capsulas", "cajas"],
      ["2372-24", "CATENA CABERNET-MALBEC", 6, 100, 200, 300, 1800, 10348, 20383, "", "30354A", "72460-25"],
    ],
    ANALISIS: [
      [],
      ["Codigo", "Descripcion", "Stock", "Pendiente", "Necesidad", "A comprar"],
      [20383, "CORCHO CATENA", 600, 200, 1_200, -400],
      [10348, "BOTELLA CATENA", 2_000, 0, 1_800, 200],
    ],
    STOCK: [["Código"], [20383]],
    PENDIENTE: [["Fecha OC"], ["01/08/26"]],
  }, "Compras.xlsx");

  assert.equal(result.periodLabel, "Agosto – Septiembre 2026");
  assert.equal(result.estimates[0].totalBottles, 1_800);
  assert.equal(result.estimates[0].materials.bottle, "10348");
  assert.equal(result.estimates[0].materials.cork, "20383");
  assert.equal(result.estimates[0].materials.box, "72460-25");
  assert.equal(result.analysis[0].balance, -400);
  assert.equal(result.analysis[0].toBuy, 400);
  assert.equal(result.analysis[1].toBuy, 0);
});

test("el servidor ignora el saldo recibido y aplica Stock + Pendiente - Necesidad", () => {
  const normalized = normalizeMonthlyPurchasePlan({
    fileName: "Análisis.xlsx",
    periodLabel: "Agosto 2026",
    estimates: [{
      productCode: "330-24",
      description: "ALAMOS MALBEC",
      presentation: 6,
      months: [{ key: "2026-08", label: "Agosto 2026", boxes: 10 }],
      totalBoxes: 10,
      totalBottles: 60,
      materials: { bottle: "10248", cork: "20376", cap: "", capsule: "30217", box: "72456D" },
    }],
    analysis: [{
      materialCode: "20376",
      description: "TAPÓN",
      stock: 20,
      pending: 10,
      necessity: 100,
      balance: 999,
      toBuy: 0,
      note: "",
    }],
    sourceCounts: { stockRows: 1, pendingRows: 1 },
  });

  assert.equal(normalized.analysis[0].balance, -70);
  assert.equal(normalized.analysis[0].toBuy, 70);
});
