import assert from "node:assert/strict";
import test from "node:test";
import {
  detectMonthlyPurchaseSources,
  normalizeMonthlyPurchasePlan,
  parseAutomaticMonthlyPurchaseSources,
  parseMonthlyPurchaseSheets,
} from "../lib/monthly-purchases.ts";

const estimateRows = [
  ["canal", "TOTAL BODEGA"],
  ["CÓDIGO", "VARIEDAD", "PRESENTACIÓN", 46235, 46266],
  [],
  [
    "",
    "",
    "",
    "",
    "",
    "total cajas",
    "total botellas",
    "botella",
    "tapon",
    "tapa",
    "capsulas",
    "cajas",
  ],
  [
    "2372-24",
    "CATENA CABERNET-MALBEC",
    6,
    100,
    200,
    300,
    1_800,
    10348,
    20383,
    "",
    "30354A",
    "72460-25",
  ],
];

const stockRows = [
  ["Codigo de producto", "Descripcion", "2", "C18", "TOTAL"],
  [20383, "CORCHO CATENA", 400, 200, 600],
  [10348, "BOTELLA CATENA", 1_000, 1_000, 2_000],
  ["30354A", "CAPSULA CATENA", 0, 100, 100],
  ["72460-25", "CAJA CATENA", 0, 40, 40],
];

const pendingRows = [
  [
    "Fecha OC",
    "Nro. OC",
    "Proveedor",
    "Producto/C",
    "Descripcion Producto/C",
    "F.Entr.",
    "C.por D./E.",
    "Cant. OC.",
  ],
  ["01/06/26", "150", "A", 20383, "CORCHO CATENA", "30/06/26", 200, 1_000],
  ["01/06/26", "150", "A", 20383, "CORCHO CATENA", "30/06/26", 200, 1_000],
  ["02/06/26", "151", "B", 20383, "CORCHO CATENA", "30/08/26", -50, 500],
  ["03/06/26", "152", "C", "30354A", "CAPSULA CATENA", "30/08/26", 400, 500],
];

test("calcula necesidad desde ESTIMADO y usa C.por D./E. del PENDIENTE", () => {
  const result = parseAutomaticMonthlyPurchaseSources(
    {
      estimate: estimateRows,
      stock: stockRows,
      pending: pendingRows,
    },
    {
      fileName: "Fuentes mensuales",
      roundingMultiple: 10_000,
      today: new Date(2026, 6, 1),
    },
  );

  assert.equal(result.periodLabel, "Agosto – Septiembre 2026");
  assert.equal(result.estimates[0].totalBottles, 1_800);
  assert.equal(result.estimates[0].materials.bottle, "10348");
  assert.equal(result.estimates[0].materials.cork, "20383");
  assert.equal(result.estimates[0].materials.box, "72460-25");

  const cork = result.analysis.find((item) => item.materialCode === "20383");
  assert.ok(cork);
  assert.equal(cork.necessity, 1_800);
  assert.equal(cork.stock, 600);
  assert.equal(cork.pending, 200);
  assert.equal(cork.balance, -1_000);
  assert.equal(cork.exactShortage, 1_000);
  assert.equal(cork.toBuy, 10_000);
  assert.equal(result.sourceCounts.duplicatePendingRows, 1);
  assert.equal(result.sourceCounts.negativePendingRows, 1);
  assert.equal(result.sourceCounts.overduePendingRows, 1);
});

test("un archivo consolidado funciona sin hoja ANALISIS", () => {
  const result = parseMonthlyPurchaseSheets(
    {
      ESTIMADO: estimateRows,
      STOCK: stockRows,
      PENDIENTE: pendingRows,
    },
    "Compras.xlsx",
  );

  assert.equal(result.analysis.length, 4);
  assert.equal(result.sourceCounts.analysisRows, 0);
  assert.equal(result.sourceFiles.estimate, "Compras.xlsx");
});

test("detecta archivos separados aunque la hoja se llame Hoja1", () => {
  assert.ok(
    detectMonthlyPurchaseSources({ Hoja1: estimateRows }).estimate,
  );
  assert.ok(detectMonthlyPurchaseSources({ Hoja1: stockRows }).stock);
  assert.ok(detectMonthlyPurchaseSources({ Hoja1: pendingRows }).pending);
});

test("ANALISIS es opcional y solo se usa para comparar", () => {
  const result = parseAutomaticMonthlyPurchaseSources(
    {
      estimate: estimateRows,
      stock: stockRows,
      pending: pendingRows,
      analysis: [
        ["Codigo", "Descripcion", "Stock", "Pendiente", "Necesidad", "A comprar"],
        [20383, "CORCHO CATENA", 600, 200, 1_800, -1_000],
      ],
    },
    { today: new Date(2026, 6, 1) },
  );
  const cork = result.analysis.find((item) => item.materialCode === "20383");
  assert.equal(cork?.comparison?.toBuy, 1_000);
  assert.equal(cork?.comparison?.shortageDifference, 0);
});

test("el servidor recalcula saldo y compra redondeada", () => {
  const normalized = normalizeMonthlyPurchasePlan({
    fileName: "Análisis.xlsx",
    periodLabel: "Agosto 2026",
    estimates: [
      {
        productCode: "330-24",
        description: "ALAMOS MALBEC",
        presentation: 6,
        months: [{ key: "2026-08", label: "Agosto 2026", boxes: 10 }],
        totalBoxes: 10,
        totalBottles: 60,
        materials: {
          bottle: "10248",
          cork: "20376",
          cap: "",
          capsule: "30217",
          box: "72456D",
        },
      },
    ],
    analysis: [
      {
        materialCode: "20376",
        description: "TAPÓN",
        stock: 20,
        pending: 10,
        necessity: 100,
        balance: 999,
        exactShortage: 0,
        toBuy: 0,
        note: "",
      },
    ],
    roundingMultiple: 10_000,
    warnings: [],
    sourceFiles: {},
    sourceCounts: {
      estimateRows: 1,
      stockRows: 1,
      pendingRows: 1,
      analysisRows: 0,
      negativePendingRows: 0,
      duplicatePendingRows: 0,
      overduePendingRows: 0,
    },
  });

  assert.equal(normalized.analysis[0].balance, -70);
  assert.equal(normalized.analysis[0].exactShortage, 70);
  assert.equal(normalized.analysis[0].toBuy, 10_000);
});
