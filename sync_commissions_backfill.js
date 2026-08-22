const Database = require('better-sqlite3');
const db = new Database('local.db');

console.log("=== MEMULAI SINKRONISASI KOMISI TERAPIS ===");

// COA references
const COA = {
  KAS: "acc_101",
  BEBAN_KOMISI: "acc_502"
};

// Fetch all necessary data
const therapists = db.prepare("SELECT * FROM therapists").all();
const tsComms = db.prepare("SELECT * FROM therapist_service_commissions").all();
const invoices = db.prepare("SELECT * FROM invoices").all();
const visits = db.prepare("SELECT * FROM patient_visits WHERE therapist_id IS NOT NULL AND status IN ('completed', 'in_progress')").all();
const therapistCommissions = db.prepare("SELECT * FROM therapist_commissions").all();
const financeTrx = db.prepare("SELECT * FROM finance_transactions WHERE category='Bagi Hasil Terapis'").all();
const journalEntries = db.prepare("SELECT * FROM journal_entries").all();
const journalLines = db.prepare("SELECT * FROM journal_lines").all();

// Build maps
const customRates = {};
tsComms.forEach(t => {
   customRates[`${t.therapist_id}_${t.service_id}`] = t.commission_amount;
});

const therapistMap = {};
therapists.forEach(t => {
   therapistMap[t.id] = t;
});

const invoicesByVisit = {};
invoices.forEach(inv => {
    if (inv.visit_id) invoicesByVisit[inv.visit_id] = inv;
});

// Group current commissions by visit_id
const currentCommissionsByVisit = {};
therapistCommissions.forEach(c => {
    if (!currentCommissionsByVisit[c.visit_id]) currentCommissionsByVisit[c.visit_id] = [];
    currentCommissionsByVisit[c.visit_id].push(c);
});

// Calculate correct total for each visit
let updatedCount = 0;

db.transaction(() => {
    visits.forEach(v => {
        const inv = invoicesByVisit[v.id];
        const t = therapistMap[v.therapist_id];
        if (!t) return;
        
        let correctTotal = 0;
        
        if (inv) {
            let items = [];
            try { items = JSON.parse(inv.items); } catch(e){}
            items.forEach(item => {
                const svcId = item.serviceId || item.name;
                const key = `${v.therapist_id}_${svcId}`;
                let amt = t.commission_rate || 0;
                if (customRates[key] != null) amt = customRates[key];
                correctTotal += amt * (item.qty || 1);
            });
        } else {
            const svcId = v.service_id;
            const key = `${v.therapist_id}_${svcId}`;
            let amt = t.commission_rate || 0;
            if (customRates[key] != null) amt = customRates[key];
            correctTotal += amt;
        }

        const existingComms = currentCommissionsByVisit[v.id] || [];
        const currentTotal = existingComms.reduce((sum, c) => sum + c.amount, 0);

        if (correctTotal !== currentTotal && existingComms.length > 0) {
            console.log(`[Visit ${v.id}] Koreksi Komisi: Rp${currentTotal} -> Rp${correctTotal}`);
            
            const diff = correctTotal - currentTotal;
            const targetComm = existingComms[0]; // Update the first one to absorb the diff
            const newAmount = targetComm.amount + diff;

            // 1. Update therapist_commissions
            db.prepare("UPDATE therapist_commissions SET amount = ? WHERE id = ?").run(newAmount, targetComm.id);

            // 2. Update finance_transactions
            // Find all finance transactions for this visit related to komisi
            const relatedFin = financeTrx.filter(f => f.reference_id === v.id || (inv && f.reference_id === inv.id));
            if (relatedFin.length > 0) {
                const targetFin = relatedFin[0]; // Absorb diff in the first transaction
                const newFinAmt = targetFin.amount + diff;
                db.prepare("UPDATE finance_transactions SET amount = ? WHERE id = ?").run(newFinAmt, targetFin.id);

                // 3. Update journal_lines
                const relatedJe = journalEntries.filter(je => je.reference_id === targetFin.id);
                relatedJe.forEach(je => {
                    const lines = journalLines.filter(jl => jl.entry_id === je.id);
                    lines.forEach(line => {
                        // Jika ada debit atau credit, sesuaikan
                        if (line.debit > 0) {
                            db.prepare("UPDATE journal_lines SET debit = ? WHERE id = ?").run(line.debit + diff, line.id);
                        }
                        if (line.credit > 0) {
                            db.prepare("UPDATE journal_lines SET credit = ? WHERE id = ?").run(line.credit + diff, line.id);
                        }
                    });
                });
            }
            
            updatedCount++;
        }
    });

    // 4. Update therapist_monthly_reports
    const monthlyReports = db.prepare("SELECT * FROM therapist_monthly_reports").all();
    monthlyReports.forEach(report => {
        const month = report.month; // YYYY-MM
        const tid = report.therapist_id;
        
        // Find all commissions for this therapist in this month
        // We need to join with patient_visits to get the date
        const monthlyComms = db.prepare(`
            SELECT SUM(c.amount) as total
            FROM therapist_commissions c
            JOIN patient_visits v ON c.visit_id = v.id
            WHERE c.therapist_id = ? AND v.visit_date LIKE ?
        `).get(tid, `${month}%`);
        
        const newTotal = monthlyComms.total || 0;
        
        if (newTotal !== report.commissions) {
            console.log(`[Laporan Bulanan ${tid} - ${month}] Koreksi: Rp${report.commissions} -> Rp${newTotal}`);
            
            // Juga hitung ulang take_home_pay jika perlu
            const newThp = report.base_salary + newTotal + report.allowances + report.bonuses - report.deductions;
            
            db.prepare("UPDATE therapist_monthly_reports SET commissions = ?, take_home_pay = ? WHERE id = ?").run(newTotal, newThp, report.id);
        }
    });
})();

console.log(`\nSelesai! Berhasil mengoreksi ${updatedCount} data kunjungan.`);
