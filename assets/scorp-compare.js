'use strict';
/* Solo Ops Tools — 2026 S-corp vs sole proprietor / single-member LLC comparison.
 *
 * Sources (see SOURCES.md): IRS Rev. Proc. 2025-32 (2026 brackets, standard
 * deduction, §199A thresholds); SSA 2026 contribution and benefit base
 * ($184,500); Schedule SE; IRS Form 1120-S / Schedule K-1 mechanics; state
 * revenue department minimum-tax schedules (CA, NY, NJ, FL).
 *
 * The comparison is a full income-tax comparison, not just a payroll-tax
 * difference: losing the employer tax deduction and part of the §199A
 * deduction changes the income tax on the S-corp side too.
 * Estimates for planning only — not tax advice.
 */

var TAX_YEAR = 2026;
var SS_WAGE_BASE = 184500;        // SSA 2026
var SE_BASE_FACTOR = 0.9235;      // Schedule SE: 92.35% of net earnings
var SE_RATE_SS = 0.124;
var SE_RATE_MEDICARE = 0.029;
var ADDL_MEDICARE_RATE = 0.009;
var ADDL_MEDICARE_THRESHOLD = { single: 200000, mfj: 250000 };
var EMPLOYER_SS_RATE = 0.062;     // employer half of Social Security
var EMPLOYER_MEDICARE_RATE = 0.0145;
var FUTA_WAGE_BASE = 7000;        // FUTA applies to the first $7,000 of wages
var FUTA_RATE = 0.006;            // 0.6% net of the state credit (max $42)
var QBI_RATE = 0.20;              // §199A, made permanent by OBBBA (2025)
var QBI_THRESHOLD = { single: 201750, mfj: 403500 };  // Rev. Proc. 2025-32, 2026

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

/* Self-employment tax for a sole proprietor / disregarded single-member LLC. */
function seTaxFor(profit, status) {
  var filing = (status === 'mfj') ? 'mfj' : 'single';
  var base = profit * SE_BASE_FACTOR;
  var ss = Math.min(base, SS_WAGE_BASE) * SE_RATE_SS;
  var medicare = base * SE_RATE_MEDICARE;
  var addl = Math.max(0, profit - ADDL_MEDICARE_THRESHOLD[filing]) * ADDL_MEDICARE_RATE;
  return round2(ss + medicare + addl);
}

/* FICA on an S-corp shareholder-employee's W-2 salary, both halves together. */
function ficaFor(salary, status) {
  var filing = (status === 'mfj') ? 'mfj' : 'single';
  var ssBase = Math.min(salary, SS_WAGE_BASE);
  // Employee 6.2% + employer 6.2% = 12.4% of Social Security wages;
  // 1.45% + 1.45% = 2.9% of Medicare wages with no cap.
  var total = ssBase * EMPLOYER_SS_RATE * 2 +
              salary * EMPLOYER_MEDICARE_RATE * 2 +
              Math.max(0, salary - ADDL_MEDICARE_THRESHOLD[filing]) * ADDL_MEDICARE_RATE;
  // The employer half is a company deduction; the 0.9% Additional Medicare Tax
  // has no employer match.
  var employer = ssBase * EMPLOYER_SS_RATE + salary * EMPLOYER_MEDICARE_RATE;
  return { total: round2(total), employerShare: round2(employer) };
}

/* §199A deduction: 20% of QBI, capped at 20% of taxable income before it.
 * The wage/UBIA limit and the SSTB phase-out above the 2026 threshold are not
 * modeled — the page warns when income is in that zone. */
function qbiDeduction(qbi, taxableBeforeQbi) {
  return round2(Math.min(QBI_RATE * Math.max(0, qbi), QBI_RATE * Math.max(0, taxableBeforeQbi)));
}

/* S-corp-specific state cost on top of what the state already charges an LLC.
 * Net profit is used as a stand-in for receipts where the state charges by
 * receipts — a documented approximation. */
function stateScorpCost(state, profit) {
  var p = Math.max(0, profit);
  if (state === 'CA') {
    // S corp pays the greater of the $800 minimum franchise tax or 1.5% of
    // California net income; a California LLC already pays the $800.
    return round2(Math.max(0, Math.max(800, p * 0.015) - 800));
  }
  if (state === 'NY') {
    // Form CT-3-S fixed dollar minimum, by New York receipts (CT-3-S-I).
    if (p <= 100000) return 25;
    if (p <= 250000) return 50;
    if (p <= 500000) return 175;
    if (p <= 1000000) return 300;
    if (p <= 5000000) return 1000;
    if (p <= 25000000) return 3000;
    return 4500;
  }
  if (state === 'NJ') {
    // New Jersey CBT statutory minimum, by New Jersey gross receipts.
    if (p < 100000) return 375;
    if (p < 250000) return 562;
    if (p < 500000) return 750;
    if (p < 1000000) return 1125;
    return 1500;
  }
  // Florida: no state income tax, and the 5.5% corporate income tax reaches an
  // S corp only if it pays federal income tax on Form 1120S, line 23c.
  return 0;
}

/* Sole proprietor / single-member LLC (disregarded entity). */
function soleProprietor(profit, status) {
  var filing = (status === 'mfj') ? 'mfj' : 'single';
  var p = Math.max(0, Number(profit) || 0);
  var se = seTaxFor(p, filing);
  var halfSe = round2(se / 2);
  var qbi = Math.max(0, round2(p - halfSe));
  var taxableBefore = Math.max(0, round2(p - halfSe - STANDARD_DEDUCTION[filing]));
  var qbiDed = qbiDeduction(qbi, taxableBefore);
  var taxable = Math.max(0, round2(taxableBefore - qbiDed));
  var fed = federalTax(taxable, filing);
  return {
    seTax: se, halfSeDeduction: halfSe, qbi: qbi, qbiDeduction: qbiDed,
    taxableIncome: taxable, federalTax: fed,
    totalBurden: round2(se + fed),
    takeHome: round2(p - se - fed)
  };
}

/* S corporation: salary is W-2 wages, the rest flows out on a K-1. */
function sCorporation(profit, salaryInput, status, extraCosts, state) {
  var filing = (status === 'mfj') ? 'mfj' : 'single';
  var p = Math.max(0, Number(profit) || 0);
  var wanted = Math.max(0, Number(salaryInput) || 0);
  var salary = Math.min(wanted, p);            // cannot pay wages out of money the company does not have
  var f = ficaFor(salary, filing);
  var futa = round2(Math.min(salary, FUTA_WAGE_BASE) * FUTA_RATE);
  var costs = Math.max(0, Number(extraCosts) || 0);
  var st = stateScorpCost(state, p);
  var companyDeductions = round2(f.employerShare + futa + costs + st);
  var k1 = round2(p - salary - companyDeductions);
  var qbi = Math.max(0, k1);
  var taxableBefore = Math.max(0, round2(salary + k1 - STANDARD_DEDUCTION[filing]));
  var qbiDed = qbiDeduction(qbi, taxableBefore);
  var taxable = Math.max(0, round2(taxableBefore - qbiDed));
  var fed = federalTax(taxable, filing);
  var totalBurden = round2(f.total + fed + futa + costs + st);
  return {
    salaryCapped: wanted > salary, salary: salary, payrollTax: f.total,
    employerShare: f.employerShare, futa: futa, distribution: k1,
    qbi: qbi, qbiDeduction: qbiDed, taxableIncome: taxable, federalTax: fed,
    extraCosts: costs, stateCost: st,
    totalBurden: totalBurden,
    takeHome: round2(p - totalBurden)
  };
}

/* Full comparison for one profit level. */
function compareSCorp(profit, salary, status, costs, state) {
  var sp = soleProprietor(profit, status);
  var sc = sCorporation(profit, salary, status, costs, state);
  var savings = round2(sp.totalBurden - sc.totalBurden);
  return {
    profit: round2(Math.max(0, Number(profit) || 0)),
    soleProp: sp,
    sCorp: sc,
    annualSavings: savings,
    sCorpWins: savings > 0
  };
}

/* Profit at which the election stops losing money, holding the salary rule and
 * the added costs fixed. Scans upward in $250 steps. */
function breakEvenProfit(salary, status, costs, state) {
  var start = Math.max(20000, Math.min(Math.max(0, Number(salary) || 0), 450000));
  for (var p = start; p <= 500000; p += 250) {
    if (compareSCorp(p, salary, status, costs, state).annualSavings > 0) {
      return { profit: p, atScanFloor: (p === start) };
    }
  }
  return null;
}

/* A small profit ladder for the scenario table. */
function scenarioLadder(profitNow, salary, status, costs, state) {
  var levels = [50000, 75000, 100000, 150000, 200000];
  if (profitNow > 0) levels.push(Math.round(profitNow / 1000) * 1000);
  var seen = {}, rows = [];
  levels.sort(function (a, b) { return a - b; });
  for (var i = 0; i < levels.length; i++) {
    var p = levels[i];
    if (p < 10000) continue;
    if (seen[p]) continue;
    seen[p] = true;
    var c = compareSCorp(p, salary, status, costs, state);
    rows.push({
      profit: p,
      solePropTax: c.soleProp.totalBurden,
      sCorpPayrollTax: c.sCorp.payrollTax,
      sCorpBurden: c.sCorp.totalBurden,
      savings: c.annualSavings,
      salaryUsed: c.sCorp.salary
    });
  }
  return rows;
}

function fmtUSD(n) {
  var v = Number(n) || 0;
  var sign = v < 0 ? '-' : '';
  return sign + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtSigned(n) {
  var v = Number(n) || 0;
  return (v > 0 ? '+' : v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/* Browser wiring — runs only when a DOM is present. */
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('scorp-form');
    if (!form) return;
    var results = document.getElementById('scorp-results');
    var errorEl = document.getElementById('scorp-error');

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var profit = parseFloat(document.getElementById('scorp-profit').value);
      var salary = parseFloat(document.getElementById('scorp-salary').value);
      var costs = parseFloat(document.getElementById('scorp-costs').value) || 0;
      var status = (document.querySelector('input[name="scorp-status"]:checked') || {}).value || 'single';
      var state = document.getElementById('scorp-state').value;

      if (isNaN(profit) || profit < 1000) {
        errorEl.textContent = 'Enter an expected net profit of at least $1,000.';
        results.classList.remove('show');
        return;
      }
      if (isNaN(salary) || salary < 0) {
        errorEl.textContent = 'Enter the salary you would pay yourself (use 0 only to see the comparison with no wages).';
        results.classList.remove('show');
        return;
      }
      errorEl.textContent = '';

      var c = compareSCorp(profit, salary, status, costs, state);
      var be = breakEvenProfit(salary, status, costs, state);

      document.getElementById('r-savings').textContent = fmtSigned(c.annualSavings);
      document.getElementById('r-savings').className = 'v ' + (c.sCorpWins ? 'pos' : 'neg');
      document.getElementById('r-verdict').textContent = c.sCorpWins
        ? 'The S-corp election saves money at these numbers.'
        : 'The S-corp election costs more at these numbers.';
      document.getElementById('r-se-sp').textContent = fmtUSD(c.soleProp.seTax);
      document.getElementById('r-se-sc').textContent = fmtUSD(c.sCorp.payrollTax);
      document.getElementById('r-fed-sp').textContent = fmtUSD(c.soleProp.federalTax);
      document.getElementById('r-fed-sc').textContent = fmtUSD(c.sCorp.federalTax);
      document.getElementById('r-costs-sc').textContent = fmtUSD(c.sCorp.extraCosts + c.sCorp.stateCost + c.sCorp.futa);
      document.getElementById('r-total-sp').textContent = fmtUSD(c.soleProp.totalBurden);
      document.getElementById('r-total-sc').textContent = fmtUSD(c.sCorp.totalBurden);
      document.getElementById('r-takehome-sp').textContent = fmtUSD(c.soleProp.takeHome);
      document.getElementById('r-takehome-sc').textContent = fmtUSD(c.sCorp.takeHome);
      document.getElementById('r-salary').textContent = fmtUSD(c.sCorp.salary);
      document.getElementById('r-distribution').textContent = fmtUSD(Math.max(0, c.sCorp.distribution));
      document.getElementById('r-breakeven').textContent = be
        ? (be.atScanFloor
            ? 'At any profit level in this range ($' + be.profit.toLocaleString('en-US') + '+ with this salary)'
            : 'About ' + fmtUSD(be.profit) + ' of net profit')
        : 'Over $500,000 with this salary — or never';

      var warn = [];
      if (salary > 0 && salary < profit * 0.4) {
        warn.push('A salary below 40% of profit is the pattern the IRS most often challenges: the election requires reasonable compensation for the work you do, and a low salary is what gets distributions reclassified as wages.');
      }
      if (c.sCorp.salaryCapped) {
        warn.push('Your salary was capped at your net profit — the company cannot pay wages it does not earn.');
      }
      var qbiTop = QBI_THRESHOLD[(status === 'mfj') ? 'mfj' : 'single'];
      if (c.soleProp.taxableIncome + c.soleProp.qbiDeduction > qbiTop) {
        warn.push('Your taxable income is above the 2026 §199A threshold ($' + qbiTop.toLocaleString('en-US') + '). Above it the QBI deduction is limited to 50% of W-2 wages (or 25% + 2.5% of property) and phases out entirely for a specified service trade or business — consulting, law, health, financial services, brokerage. If that applies to you, the S-corp\'s real advantage is smaller than shown here.');
      }
      var warnEl = document.getElementById('scorp-warning');
      warnEl.innerHTML = warn.map(function (w) { return '<p>' + w + '</p>'; }).join('');
      warnEl.style.display = warn.length ? 'block' : 'none';

      var stateNote = {
        CA: 'California added 1.5% of net income above the $800 minimum franchise tax a California LLC already pays.',
        NY: 'New York added the Form CT-3-S fixed dollar minimum for your profit level ($25–$4,500 by New York receipts). The MTA surcharge does not apply to a New York S corporation; New York City\'s General Corporation Tax is not modeled.',
        NJ: 'New Jersey added the Corporation Business Tax statutory minimum ($375–$1,500 by New Jersey gross receipts).',
        FL: 'Florida added nothing: no state income tax, and the 5.5% corporate income tax reaches an S corp only if it pays federal income tax on Form 1120S line 23c.'
      }[state] || 'No state S-corp cost was added. Check your state\'s minimum tax, franchise fee, or entity-level tax before electing — several states charge one, and some cities charge another.';
      document.getElementById('scorp-state-note').textContent = stateNote;

      var rows = '';
      var sp = c.soleProp, sc = c.sCorp;
      rows += '<tr><td>Self-employment / payroll tax</td><td class="num">' + fmtUSD(sp.seTax) + '</td><td class="num">' + fmtUSD(sc.payrollTax) + '</td></tr>';
      rows += '<tr><td>&nbsp;&nbsp;of which employer half (company deduction)</td><td class="num">—</td><td class="num">' + fmtUSD(sc.employerShare) + '</td></tr>';
      rows += '<tr><td>Federal income tax (after the §199A deduction)</td><td class="num">' + fmtUSD(sp.federalTax) + '</td><td class="num">' + fmtUSD(sc.federalTax) + '</td></tr>';
      rows += '<tr><td>&nbsp;&nbsp;§199A (QBI) deduction applied</td><td class="num">' + fmtUSD(sp.qbiDeduction) + '</td><td class="num">' + fmtUSD(sc.qbiDeduction) + '</td></tr>';
      rows += '<tr><td>Payroll service, 1120-S, state minimum tax, FUTA</td><td class="num">—</td><td class="num">' + fmtUSD(sc.extraCosts + sc.stateCost + sc.futa) + '</td></tr>';
      rows += '<tr class="cheapest"><td><strong>Total cost of the year</strong></td><td class="num"><strong>' + fmtUSD(sp.totalBurden) + '</strong></td><td class="num"><strong>' + fmtUSD(sc.totalBurden) + '</strong></td></tr>';
      rows += '<tr><td>Left for you after federal tax and costs</td><td class="num">' + fmtUSD(sp.takeHome) + '</td><td class="num">' + fmtUSD(sc.takeHome) + '</td></tr>';
      document.getElementById('scorp-rows').innerHTML = rows;

      var ladder = scenarioLadder(profit, salary, status, costs, state);
      var srows = '';
      ladder.forEach(function (r) {
        var better = r.savings > 0 ? 'S corp' : (r.savings < 0 ? 'Sole prop / LLC' : 'Tie');
        srows += '<tr class="' + (r.savings > 0 ? 'cheapest' : '') + '">' +
          '<td>' + fmtUSD(r.profit) + '</td>' +
          '<td class="num">' + fmtUSD(r.salaryUsed) + '</td>' +
          '<td class="num">' + fmtUSD(r.solePropTax) + '</td>' +
          '<td class="num">' + fmtUSD(r.sCorpBurden) + '</td>' +
          '<td class="num">' + fmtSigned(r.savings) + '</td>' +
          '<td>' + better + '</td></tr>';
      });
      document.getElementById('scorp-scenarios').innerHTML = srows;

      results.classList.add('show');
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

/* Node/test export (no effect in the browser). */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    compareSCorp: compareSCorp, soleProprietor: soleProprietor, sCorporation: sCorporation,
    seTaxFor: seTaxFor, ficaFor: ficaFor, federalTax: federalTax, stateScorpCost: stateScorpCost,
    breakEvenProfit: breakEvenProfit, scenarioLadder: scenarioLadder, fmtUSD: fmtUSD
  };
}
