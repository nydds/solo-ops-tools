'use strict';
/* Solo Ops Tools — LLC cost comparison (WY / DE / FL / NY).
 *
 * Sources (see SOURCES.md): each state's Secretary of State fee schedule,
 * verified 2026; NY Dept. of Taxation and Finance Form IT-204-LL tiers;
 * NY LLC Law § 206 (publication requirement).
 * All figures are state fees for 2026. Registered-agent fees are third-party
 * services, not state fees, and are not included.
 */

var STATES = {
  wy: {
    code: 'WY', name: 'Wyoming',
    filingFee: 100,
    annualReport: 60,          // minimum; or $0.0002 per $1 of assets in WY
    annualReportAssetRate: 0.0002,
    franchiseTax: 0,
    notes: 'No franchise tax. No state individual income tax. Strongest single-member charging-order protection.'
  },
  de: {
    code: 'DE', name: 'Delaware',
    filingFee: 90,
    annualReport: 0,
    franchiseTax: 300,         // flat annual franchise tax for LLCs
    notes: 'Court of Chancery. The default choice for venture-backed companies.'
  },
  fl: {
    code: 'FL', name: 'Florida',
    filingFee: 125,
    annualReport: 138.75,
    franchiseTax: 0,
    notes: 'No state individual income tax. Annual report due Jan 1 – May 1.'
  },
  ny: {
    code: 'NY', name: 'New York',
    filingFee: 200,
    biennialStatement: 9,      // every 2 years
    certOfPublication: 50,
    franchiseTax: 0,           // no franchise tax, but IT-204-LL annual filing fee applies
    notes: 'Mandatory newspaper publication (LLC Law § 206) plus an income-based annual filing fee (Form IT-204-LL).'
  }
};

// NY publication cost by county tier — estimates; newspapers set their own
// rates, the state does not. See SOURCES.md.
var NY_PUBLICATION = {
  upstate: { label: 'Low-cost upstate county', cost: 200 },
  typical: { label: 'Typical county', cost: 500 },
  outer: { label: 'NYC outer boroughs', cost: 1000 },
  manhattan: { label: 'Manhattan', cost: 1500 }
};

// Form IT-204-LL annual filing fee on prior-year NY-source gross income.
function nyAnnualFilingFee(grossIncome) {
  var g = Math.max(0, Number(grossIncome) || 0);
  if (g <= 100000) return 25;
  if (g <= 250000) return 50;
  if (g <= 500000) return 175;
  if (g <= 1000000) return 500;
  if (g <= 5000000) return 1500;
  if (g <= 25000000) return 3000;
  return 4500;
}

function round2(n) { return Math.round((n + 1e-9) * 100) / 100; } // +1e-9: deterministic half-up on binary edge values

/**
 * Cost model for one state.
 * @param {string} code - 'wy' | 'de' | 'fl' | 'ny'
 * @param {number} years - horizon in years (1..10)
 * @param {object} opts - { nyPublicationTier, nyGrossIncome, wyAssets }
 */
function llcCosts(code, years, opts) {
  var s = STATES[code];
  if (!s) throw new Error('Unknown state code: ' + code);
  var y = Math.max(1, Math.min(10, Math.round(Number(years) || 1)));
  var o = opts || {};
  var nyTier = NY_PUBLICATION[o.nyPublicationTier] ? o.nyPublicationTier : 'typical';
  var nyGross = Math.max(0, Number(o.nyGrossIncome) || 0);
  var wyAssets = Math.max(0, Number(o.wyAssets) || 0);

  var year1 = 0;
  var annual = 0;
  var detail = {};

  if (code === 'wy') {
    annual = Math.max(60, round2(wyAssets * 0.0002));
    year1 = round2(s.filingFee + annual);
    detail = { filing: s.filingFee, recurring: annual, recurringLabel: 'Annual report (min $60)' };
  } else if (code === 'de') {
    annual = s.franchiseTax;
    year1 = round2(s.filingFee + annual);
    detail = { filing: s.filingFee, recurring: annual, recurringLabel: 'Annual franchise tax' };
  } else if (code === 'fl') {
    annual = s.annualReport;
    year1 = round2(s.filingFee + annual);
    detail = { filing: s.filingFee, recurring: annual, recurringLabel: 'Annual report' };
  } else if (code === 'ny') {
    var pub = NY_PUBLICATION[nyTier].cost;
    var it204 = nyAnnualFilingFee(nyGross);
    var biennialPerYear = s.biennialStatement / 2;
    annual = round2(it204 + biennialPerYear);
    // First year: $25 flat IT-204-LL (no prior-year income), per NY guidance.
    var firstYearIt204 = 25;
    var firstYearAnnual = round2(firstYearIt204 + biennialPerYear);
    year1 = round2(s.filingFee + s.certOfPublication + pub + firstYearAnnual);
    detail = {
      filing: s.filingFee, publication: pub, certOfPublication: s.certOfPublication,
      recurring: annual, recurringLabel: 'IT-204-LL fee + biennial statement ($4.50/yr)',
      it204Annual: it204, publicationTier: NY_PUBLICATION[nyTier].label
    };
  }

  var total = round2(year1 + annual * (y - 1));
  return {
    code: code, name: s.name, years: y,
    year1: year1, annualRecurring: annual, total: total,
    detail: detail, notes: s.notes
  };
}

function compareAll(years, opts) {
  return ['wy', 'de', 'fl', 'ny'].map(function (code) {
    return llcCosts(code, years, opts);
  });
}

function fmtUSD(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* Browser wiring — runs only when a DOM is present. */
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('llc-form');
    if (!form) return;
    var results = document.getElementById('llc-results');
    function render() {
      var years = parseInt(document.getElementById('llc-years').value, 10) || 5;
      var tier = document.getElementById('ny-tier').value || 'typical';
      var gross = parseFloat(document.getElementById('ny-gross').value) || 0;
      var assets = parseFloat(document.getElementById('wy-assets').value) || 0;
      var rows = compareAll(years, { nyPublicationTier: tier, nyGrossIncome: gross, wyAssets: assets });
      var min = Math.min.apply(null, rows.map(function (r) { return r.total; }));
      var max = Math.max.apply(null, rows.map(function (r) { return r.total; }));
      var html = '';
      rows.forEach(function (r) {
        var cheapest = r.total === min ? ' class="cheapest"' : '';
        var pct = max > 0 ? Math.round((r.total / max) * 100) : 0;
        html += '<tr' + cheapest + '><td>' + r.name + (r.total === min ? ' ★ lowest' : '') + '</td>'
          + '<td class="num">' + fmtUSD(r.detail.filing) + '</td>'
          + '<td class="num">' + fmtUSD(r.year1) + '</td>'
          + '<td class="num">' + fmtUSD(r.annualRecurring) + '</td>'
          + '<td class="num">' + fmtUSD(r.total) + '</td>'
          + '<td><div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div></td></tr>';
      });
      document.getElementById('llc-rows').innerHTML = html;
      document.getElementById('llc-years-label').textContent = rows[0].years;
      var yearsLabel2 = document.getElementById('llc-years-label2');
      if (yearsLabel2) yearsLabel2.textContent = rows[0].years;
      document.getElementById('llc-ny-tier-label').textContent = rows[3].detail.publicationTier + ' (' + fmtUSD(rows[3].detail.publication) + ')';
      results.classList.add('show');
    }
    form.addEventListener('submit', function (ev) { ev.preventDefault(); render(); });
    form.addEventListener('change', render);
    render();
  });
}

/* Node test export (no effect in the browser). */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { llcCosts: llcCosts, compareAll: compareAll, nyAnnualFilingFee: nyAnnualFilingFee, STATES: STATES, NY_PUBLICATION: NY_PUBLICATION, fmtUSD: fmtUSD };
}
