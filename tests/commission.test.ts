import test from "node:test";
import assert from "node:assert/strict";
import { calculateCommissionAmount } from "../src/lib/commission";

test("Sistem Komisi Terapis - Hierarki", async (t) => {
  
  await t.test("Global: Menggunakan Global Commission flat", () => {
    const result = calculateCommissionAmount({
      serviceGlobalCommission: 30000,
      qty: 1
    });
    assert.equal(result, 30000, "Gagal menggunakan Global Commission");
  });

  await t.test("Fallback: Mengembalikan 0 jika global 0 atau null", () => {
    const result = calculateCommissionAmount({
      serviceGlobalCommission: 0,
      qty: 1
    });
    assert.equal(result, 0, "Harusnya mengembalikan 0");
  });

  await t.test("Multiplier: Qty > 1 harus mengkalikan hasil akhir", () => {
    const result = calculateCommissionAmount({
      serviceGlobalCommission: 30000,
      qty: 3
    });
    assert.equal(result, 90000, "Perkalian Qty gagal untuk Global");
  });

  await t.test("Multiplier: Qty 0 harus menghasilkan 0", () => {
    const result = calculateCommissionAmount({
      serviceGlobalCommission: 50000,
      qty: 0
    });
    assert.equal(result, 0, "Layanan dengan Qty 0 tidak boleh menghasilkan komisi");
  });

  await t.test("Percentage: Jika global <= 100, hitung sebagai persentase", () => {
    const result = calculateCommissionAmount({
      serviceGlobalCommission: 40,
      servicePrice: 200000,
      qty: 1
    });
    assert.equal(result, 80000, "Gagal menghitung persentase untuk serviceGlobalCommission <= 100");
  });

  await t.test("Percentage: Perkalian Qty untuk persentase", () => {
    const result = calculateCommissionAmount({
      serviceGlobalCommission: 50,
      servicePrice: 200000,
      qty: 3
    });
    assert.equal(result, 300000, "Gagal mengkalikan qty untuk persentase");
  });

});
