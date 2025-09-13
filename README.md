# NSW Rental Bond Outcomes (2024)

A static, client-side site that maps NSW postcodes and summarises **rental bond refund outcomes** for 2024.
Colour encodes rank by the chosen metric (green = lower, red = higher). Filters include dwelling type, days bond held, 
data-point counts, and advanced ranges (percent withheld, any withheld, total bond). Cards and map popups show the same per-postcode summary.

**Live usage:** Host `./` on GitHub Pages or any static server.

## Data sources (CC BY 4.0)
- ABS ASGS 2021 POA boundaries (NSW subset):  
  https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs-edition-3/jul2021-jun2026/access-and-downloads/digital-boundary-files
- ASGS correspondences (CG_LOCALITY_2021 ↔ POA_2021):  
  https://www.data.gov.au/data/dataset/asgs-edition-3-2021-correspondences
- NSW Rental bond refunds (2024):  
  https://www.nsw.gov.au/housing-and-construction/rental-forms-surveys-and-data/rental-bond-data#toc-bond-refunds

See `data/LICENSE` for attribution details. Code is MIT-licensed; third-party libraries listed in `THIRD_PARTY_NOTICES.md`.
