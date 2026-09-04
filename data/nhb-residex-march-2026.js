// Public market facts transcribed from the National Housing Bank's one-page
// NHB RESIDEX press release for the quarter ended March 2026. Operational
// records elsewhere in this project remain synthetic to protect personal data.
export const marketSnapshot = Object.freeze({
  publisher: 'National Housing Bank',
  dataset: 'NHB RESIDEX — HPI at Assessment Prices',
  quarter_end: '2026-03-31',
  published_date: '2026-06-18',
  source_url: 'https://www.nhb.org.in/wp-content/uploads/2026/06/National-Press-Release-RESIDEX-Mar26.pdf',
  methodology_note: 'Annual change in residential Housing Price Index; base year FY 2024-25.',
  rows: Object.freeze([
    { city: 'Ahmedabad', annual_change_pct: 7.2 },
    { city: 'Bengaluru', annual_change_pct: 13.1 },
    { city: 'Chennai', annual_change_pct: 8.6 },
    { city: 'Hyderabad', annual_change_pct: 3.3 },
    { city: 'Kolkata', annual_change_pct: 5.3 },
    { city: 'Mumbai', annual_change_pct: 4.5 },
    { city: 'Pune', annual_change_pct: 2.9 },
    { city: '50-city composite', annual_change_pct: 4.5, composite: true },
  ]),
});
