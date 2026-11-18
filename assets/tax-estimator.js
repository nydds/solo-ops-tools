'use strict';
/* Solo Ops Tools — 2026 1099 tax estimator.
 *
 * Sources (see SOURCES.md): IRS Revenue Procedure 2025-32 (2026 brackets and
 * standard deductions); SSA contribution and benefit base 2026 ($184,500);
 * IRS Form 1040-ES (2026 due dates); Schedule SE rules.
 * All figures are for tax year 2026. Results are estimates, not tax advice.
 */

var TAX_YEAR = 2026;
var SS_WAGE_BASE = 184500;          // SSA 2026
var SE_BASE_FACTOR = 0.9235;        // Schedule SE: 92.35% of net earnings
var SE_RATE_SS = 0.124;             // Social Security portion
var SE_RATE_MEDICARE = 0.029;       // Medicare portion (no cap)
var ADDL_MEDICARE_RATE = 0.009;     // Additional Medicare Tax
var ADDL_MEDICARE_THRESHOLD = { single: 200000, mfj: 250000 };

var STANDARD_DEDUCTION = { single: 16100, mfj: 32200 };

// 2026 federal brackets: [top of bracket, rate]. IRS Rev. Proc. 2025-32.
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

var ESTIMATED_DUE_DATES = [
  'April 15, 2026',
  'June 15, 2026',
  'September 15, 2026',
  'January 15, 2027'
];

function round2(n) { return Math.round((n + 1e-9) * 100) / 100; } // +1e-9: deterministic half-up on binary edge values (e.g. 7064.775)

function federalTax(taxable, status) {
  var table = BRACKETS[status] || BRACKETS.single;
  var tax = 0;
  var prev = 0;
  for (var i = 0; i < table.length; i++) {
    var top = table[i][0];
    var rate = table[i][1];
    if (taxable <= prev) break;
    var inBracket = Math.min(taxable, top) - prev;
    tax += inBracket * rate;
    prev = top;
  }
  return round2(tax);
}

/**
 * Estimate 2026 federal tax for a 1099 freelancer / single-member LLC.
 * @param {number} netProfit - net self-employment profit (income minus business expenses)
 * @param {string} status - 'single' or 'mfj'
 * @param {number} w2ssWages - W-2 wages already subject to Social Security tax (default 0)
 */
function estimate1099(netProfit, status, w2ssWages) {
  var profit = Math.max(0, Number(netProfit) || 0);
  var w2 = Math.max(0, Number(w2ssWages) || 0);
  var filing = (status === 'mfj') ? 'mfj' : 'single';

  var seBase = round2(profit * SE_BASE_FACTOR);
  var ssRoom = Math.max(0, SS_WAGE_BASE - w2);
  var ssTax = round2(Math.min(seBase, ssRoom) * SE_RATE_SS);
  var medicareTax = round2(seBase * SE_RATE_MEDICARE);
  // Additional Medicare Tax: (W-2 wages + net SE income) above the threshold,
  // applied to the SE portion. Simplified to net profit above the threshold
  // net of W-2 wages; see SOURCES.md.
  var addlBase = Math.max(0, Math.min(profit, profit + w2 - ADDL_MEDICARE_THRESHOLD[filing]));
  var addlMedicareTax = round2(addlBase * ADDL_MEDICARE_RATE);

  var seTax = round2(ssTax + medicareTax + addlMedicareTax);
  var halfSe = round2(seTax / 2);
  var stdDed = STANDARD_DEDUCTION[filing];
  var taxableIncome = round2(Math.max(0, profit - halfSe - stdDed));
  var fedTax = federalTax(taxableIncome, filing);
  var totalTax = round2(seTax + fedTax);
  var quarterly = round2(totalTax / 4);
  var effectiveRate = profit > 0 ? Math.round((totalTax / profit) * 1000 + 1e-9) / 10 : 0; // 1-decimal percent

  return {
    taxYear: TAX_YEAR,
    netProfit: round2(profit),
    filingStatus: filing,
    seBase: seBase,
    ssTax: ssTax,
    medicareTax: medicareTax,
    addlMedicareTax: addlMedicareTax,
    seTax: seTax,
    halfSeDeduction: halfSe,
    standardDeduction: stdDed,
    taxableIncome: taxableIncome,
    federalTax: fedTax,
    totalTax: totalTax,
    quarterlyPayment: quarterly,
    effectiveRatePct: effectiveRate,
    dueDates: ESTIMATED_DUE_DATES.slice()
  };
}

function fmtUSD(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* Browser wiring — runs only when a DOM is present. */
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('tax-form');
    if (!form) return;
    var results = document.getElementById('tax-results');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var profit = parseFloat(document.getElementById('net-profit').value);
      var status = (document.querySelector('input[name="filing-status"]:checked') || {}).value || 'single';
      var w2 = parseFloat(document.getElementById('w2-wages').value) || 0;
      if (isNaN(profit) || profit < 0) {
        document.getElementById('tax-error').textContent = 'Enter a net profit of $0 or more.';
        results.classList.remove('show');
        return;
      }
      document.getElementById('tax-error').textContent = '';
      var r = estimate1099(profit, status, w2);
      document.getElementById('r-total').textContent = fmtUSD(r.totalTax);
      document.getElementById('r-effective').textContent = r.effectiveRatePct.toFixed(1) + '%';
      document.getElementById('r-se').textContent = fmtUSD(r.seTax);
      document.getElementById('r-ss').textContent = fmtUSD(r.ssTax);
      document.getElementById('r-med').textContent = fmtUSD(r.medicareTax);
      document.getElementById('r-addl').textContent = fmtUSD(r.addlMedicareTax);
      document.getElementById('r-half').textContent = fmtUSD(r.halfSeDeduction);
      document.getElementById('r-taxable').textContent = fmtUSD(r.taxableIncome);
      document.getElementById('r-fed').textContent = fmtUSD(r.federalTax);
      document.getElementById('r-quarterly').textContent = fmtUSD(r.quarterlyPayment);
      var rows = '';
      r.dueDates.forEach(function (d, i) {
        rows += '<tr><td>Payment ' + (i + 1) + '</td><td>' + d + '</td><td class="num">' + fmtUSD(r.quarterlyPayment) + '</td></tr>';
      });
      document.getElementById('r-schedule').innerHTML = rows;
      results.classList.add('show');
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

/* Node test export (no effect in the browser). */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { estimate1099: estimate1099, federalTax: federalTax, fmtUSD: fmtUSD, SS_WAGE_BASE: SS_WAGE_BASE, STANDARD_DEDUCTION: STANDARD_DEDUCTION, ESTIMATED_DUE_DATES: ESTIMATED_DUE_DATES };
}
