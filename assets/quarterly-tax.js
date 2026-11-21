'use strict';
/* Solo Ops Tools — 2026 quarterly estimated tax and safe harbor planner.
 *
 * Sources (see SOURCES.md): IRS Rev. Proc. 2025-32 (2026 brackets, standard
 * deduction, §199A thresholds); SSA 2026 wage base ($184,500); IRS Form
 * 1040-ES (2026) due dates and the 90% / 100% / 110% rules; IRC §6654 and
 * Form 2210 (annualized income installment method, $1,000 de minimis).
 * Estimates for planning only — not tax advice.
 */

var TAX_YEAR = 2026;
var SS_WAGE_BASE = 184500;
var SE_BASE_FACTOR = 0.9235;
var SE_RATE_SS = 0.124;
var SE_RATE_MEDICARE = 0.029;
var ADDL_MEDICARE_RATE = 0.009;
var ADDL_MEDICARE_THRESHOLD = { single: 200000, mfj: 250000 };
var QBI_RATE = 0.20;
var QBI_THRESHOLD = { single: 201750, mfj: 403500 };
var SAFE_HARBOR_HIGH_INCOME_AGI = 150000;   // IRC §6654(d)(1)(C)
var SAFE_HARBOR_MULT_HIGH = 1.10;           // prior-year tax × 110%
var SAFE_HARBOR_MULT_STD = 1.00;            // prior-year tax × 100%
var REQUIRED_PCT_OF_CURRENT = 0.90;         // 90% of the current year's tax
var PENALTY_DE_MINIMIS = 1000;              // underpayment under $1,000: no penalty

var STANDARD_DEDUCTION = { single: 16100, mfj: 32200 };

var BRACKETS = {
  single: [
    [12400, 0.10], [50400, 0.12], [105700, 0.22], [201775, 0.24],
    [256225, 0.32], [640600, 0.35], [Infinity, 0.37]
  ],
  mfj: [
    [24800, 0.10], [100800, 0.12], [211400, 0.22], [403550, 0.24],
    [512450, 0.32], [768700, 0.35], [Infinity, 0.37]
  ]
};

var INSTALLMENTS = [
  { n: 1, label: 'Payment 1', due: 'April 15, 2026', period: 'Jan 1 – Mar 31, 2026' },
  { n: 2, label: 'Payment 2', due: 'June 15, 2026', period: 'Apr 1 – May 31, 2026' },
  { n: 3, label: 'Payment 3', due: 'September 15, 2026', period: 'Jun 1 – Aug 31, 2026' },
  { n: 4, label: 'Payment 4', due: 'January 15, 2027', period: 'Sep 1 – Dec 31, 2026' }
];

function round2(n) { return Math.round((n + 1e-9) * 100) / 100; }

function federalTax(taxable, status) {
  var table = BRACKETS[status] || BRACKETS.single;
  var tax = 0;
  var prev = 0;
  for (var i = 0; i < table.length; i++) {
    if (taxable <= prev) break;
    var inBracket = Math.min(taxable, table[i][0]) - prev;
    tax += inBracket * table[i][1];
    prev = table[i][0];
  }
  return round2(tax);
}

/* Projected 2026 federal tax on net self-employment profit: SE tax plus
 * income tax after half the SE tax, the standard deduction and §199A. */
function annualFederalTax(profit, status) {
  var filing = (status === 'mfj') ? 'mfj' : 'single';
  var p = Math.max(0, Number(profit) || 0);
  var seBase = p * SE_BASE_FACTOR;
  var seTax = round2(
    Math.min(seBase, SS_WAGE_BASE) * SE_RATE_SS +
    seBase * SE_RATE_MEDICARE +
    Math.max(0, p - ADDL_MEDICARE_THRESHOLD[filing]) * ADDL_MEDICARE_RATE
  );
  var halfSe = round2(seTax / 2);
  var qbi = Math.max(0, round2(p - halfSe));
  var taxableBefore = Math.max(0, round2(p - halfSe - STANDARD_DEDUCTION[filing]));
  var qbiDed = round2(Math.min(QBI_RATE * qbi, QBI_RATE * taxableBefore));
  var taxable = Math.max(0, round2(taxableBefore - qbiDed));
  var fed = federalTax(taxable, filing);
  return {
    seTax: seTax, halfSeDeduction: halfSe, qbi: qbi, qbiDeduction: qbiDed,
    taxableIncome: taxable, federalTax: fed,
    totalTax: round2(seTax + fed)
  };
}

/* The two ways to avoid the underpayment penalty. */
function safeHarborAmount(priorYearTax, highIncome) {
  var prior = Math.max(0, Number(priorYearTax) || 0);
  return round2(prior * (highIncome ? SAFE_HARBOR_MULT_HIGH : SAFE_HARBOR_MULT_STD));
}

/**
 * Build the 2026 installment plan.
 * @param {number} profit      expected net self-employment profit for 2026
 * @param {string} status      'single' | 'mfj'
 * @param {number} priorTax    2025 total tax (Form 1040, line 24)
 * @param {boolean} highIncome 2025 AGI over $150,000 → 110% safe harbor
 * @param {number} withholding federal income tax withheld in 2026 (all year)
 */
function quarterlyPlan(profit, status, priorTax, highIncome, withholding) {
  var projected = annualFederalTax(profit, status);
  var wh = Math.max(0, Number(withholding) || 0);
  var ninety = round2(projected.totalTax * REQUIRED_PCT_OF_CURRENT);
  var harbor = safeHarborAmount(priorTax, highIncome);
  // You owe the lesser of 90% of this year's tax or the prior-year safe harbor.
  var required = round2(harbor > 0 ? Math.min(ninety, harbor) : ninety);
  var remaining = round2(Math.max(0, required - wh));
  var perQuarter = round2(remaining / 4);
  var fullRemaining = round2(Math.max(0, projected.totalTax - wh));
  var perQuarterFull = round2(fullRemaining / 4);
  var balanceDue = round2(Math.max(0, projected.totalTax - wh - remaining)); // what is still owed at filing
  var installments = INSTALLMENTS.map(function (i) {
    return {
      n: i.n, label: i.label, due: i.due, period: i.period,
      minimum: perQuarter, full: perQuarterFull,
      cumulativeMinimum: round2(perQuarter * i.n)
    };
  });
  return {
    projected: projected,
    withholding: wh,
    ninetyPercent: ninety,
    safeHarbor: harbor,
    safeHarborMultiplier: highIncome ? SAFE_HARBOR_MULT_HIGH : SAFE_HARBOR_MULT_STD,
    requiredAnnual: required,
    remainingToPay: remaining,
    perQuarterMinimum: perQuarter,
    fullCoverageRemaining: fullRemaining,
    perQuarterFull: perQuarterFull,
    balanceDueAtFiling: balanceDue,
    deMinimis: (projected.totalTax - wh) < PENALTY_DE_MINIMIS,
    installments: installments
  };
}

function fmtUSD(n) {
  var v = Number(n) || 0;
  var sign = v < 0 ? '-' : '';
  return sign + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/* Browser wiring — runs only when a DOM is present. */
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('q-form');
    if (!form) return;
    var results = document.getElementById('q-results');
    var errorEl = document.getElementById('q-error');

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var profit = parseFloat(document.getElementById('q-profit').value);
      var priorTax = parseFloat(document.getElementById('q-prior').value) || 0;
      var withholding = parseFloat(document.getElementById('q-withholding').value) || 0;
      var status = (document.querySelector('input[name="q-status"]:checked') || {}).value || 'single';
      var highIncome = (document.querySelector('input[name="q-harbor"]:checked') || {}).value === '110';

      if (isNaN(profit) || profit < 0) {
        errorEl.textContent = 'Enter an expected net profit of $0 or more.';
        results.classList.remove('show');
        return;
      }
      if (priorTax < 0 || withholding < 0) {
        errorEl.textContent = 'Prior-year tax and withholding cannot be negative. Leave them at 0 if they do not apply.';
        results.classList.remove('show');
        return;
      }
      errorEl.textContent = '';

      var plan = quarterlyPlan(profit, status, priorTax, highIncome, withholding);

      document.getElementById('r-projected').textContent = fmtUSD(plan.projected.totalTax);
      document.getElementById('r-quarterly').textContent = fmtUSD(plan.perQuarterMinimum);
      document.getElementById('r-required').textContent = fmtUSD(plan.requiredAnnual);
      document.getElementById('r-safeharbor').textContent = plan.safeHarbor > 0
        ? fmtUSD(plan.safeHarbor) + ' (' + Math.round(plan.safeHarborMultiplier * 100) + '% of ' + fmtUSD(priorTax) + ')'
        : 'Not available (enter your 2025 total tax)';

      document.getElementById('r-se').textContent = fmtUSD(plan.projected.seTax);
      document.getElementById('r-fed').textContent = fmtUSD(plan.projected.federalTax);
      document.getElementById('r-qbi').textContent = fmtUSD(plan.projected.qbiDeduction);
      document.getElementById('r-wh').textContent = plan.withholding > 0 ? '−' + fmtUSD(plan.withholding) : '—';
      document.getElementById('r-remaining').textContent = fmtUSD(plan.remainingToPay);
      document.getElementById('r-perq-min').textContent = fmtUSD(plan.perQuarterMinimum);
      document.getElementById('r-perq-full').textContent = fmtUSD(plan.perQuarterFull);
      document.getElementById('r-balance').textContent = fmtUSD(plan.balanceDueAtFiling);

      var rows = '';
      plan.installments.forEach(function (i) {
        rows += '<tr><td>' + i.label + '</td><td>' + i.due + '</td>' +
          '<td class="num">' + fmtUSD(i.minimum) + '</td>' +
          '<td class="num">' + fmtUSD(i.cumulativeMinimum) + '</td>' +
          '<td class="num">' + fmtUSD(i.full) + '</td></tr>';
      });
      document.getElementById('q-rows').innerHTML = rows;

      var notes = [];
      if (plan.remainingToPay === 0) {
        notes.push('Your withholding already covers the required annual payment, so no estimated payments are needed to avoid the penalty. You may still want to pay toward the projected bill: ' + fmtUSD(plan.balanceDueAtFiling) + ' would otherwise be due with your return.');
      }
      if (plan.deMinimis) {
        notes.push('Your remaining balance after withholding is under $1,000, so the underpayment penalty generally does not apply — but the balance is still due by April 15, 2027.');
      }
      if (plan.safeHarbor === 0) {
        notes.push('With no 2025 tax entered, only the 90%-of-2026 rule applies. A first-year business cannot use the prior-year safe harbor; keep the 2025 total tax figure handy if you filed one.');
      }
      if (plan.projected.qbi > 0 && plan.projected.taxableIncome + plan.projected.qbiDeduction > QBI_THRESHOLD[(status === 'mfj') ? 'mfj' : 'single']) {
        notes.push('Your taxable income is above the 2026 §199A threshold, where the QBI deduction is limited by W-2 wages or phased out for a specified service trade or business. Projected tax here may be understated.');
      }
      var notesEl = document.getElementById('q-notes');
      notesEl.innerHTML = notes.map(function (t) { return '<p>' + t + '</p>'; }).join('');
      notesEl.style.display = notes.length ? 'block' : 'none';

      results.classList.add('show');
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

/* Node/test export (no effect in the browser). */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    annualFederalTax: annualFederalTax, safeHarborAmount: safeHarborAmount,
    quarterlyPlan: quarterlyPlan, federalTax: federalTax, fmtUSD: fmtUSD,
    INSTALLMENTS: INSTALLMENTS
  };
}
