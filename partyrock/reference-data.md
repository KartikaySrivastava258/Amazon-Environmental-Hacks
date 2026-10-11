# Punarnava reference data for the PartyRock companion

Generated from backend/src/core/catalog.js by scripts/local/partyrock-data.mjs. These are the app's **reference
assumptions** (demo values, not market data). Paste this block into the PartyRock app's "Reference data" widget.

Rule used by Punarnava: recommend repair when the cheapest repair costs at most 50% of a comparable new
product AND the product is younger than its typical lifespan. Otherwise prefer selling as-is, then harvesting parts,
then recycling through a registered recycler.

| Product | New price (Rs) | Typical lifespan (years) | Labour (Rs) | Weight (kg) | Scrap rate (Rs/kg) |
|---|---|---|---|---|---|
| Washing machine | 22000 | 10 | 600 | 35 | 18 |
| Mixer-grinder | 3500 | 6 | 200 | 3.5 | 25 |
| Ceiling fan | 2800 | 12 | 200 | 5 | 30 |
| Smartphone | 15000 | 4 | 300 | 0.2 | 400 |
| Laptop | 50000 | 6 | 800 | 2 | 250 |
| RO water purifier | 14000 | 7 | 400 | 9 | 15 |
| Refrigerator | 28000 | 12 | 800 | 50 | 16 |
| Air conditioner | 38000 | 10 | 1000 | 40 | 22 |
| Home inverter | 9000 | 8 | 500 | 12 | 40 |

Parts:
- **Washing machine:** Control board (part ~Rs 3200), Motor (part ~Rs 4200), Drain pump (part ~Rs 1200), Inlet valve (part ~Rs 650), Drum bearing (part ~Rs 1500), Belt (part ~Rs 400), Door lock (part ~Rs 700), Pressure switch (part ~Rs 550), Motor capacitor (part ~Rs 250, hazardous)
- **Mixer-grinder:** Coupler (part ~Rs 120), Motor winding (part ~Rs 900), Jar blade assembly (part ~Rs 450), Carbon brush (part ~Rs 80), Speed switch (part ~Rs 150), Overload protector (part ~Rs 120)
- **Ceiling fan:** Capacitor (part ~Rs 180), Winding (part ~Rs 700), Bearing (part ~Rs 250), Regulator (part ~Rs 300), Blades (part ~Rs 600), Canopy and shackle (part ~Rs 150)
- **Smartphone:** Battery (part ~Rs 1500, hazardous), Display (part ~Rs 3500), Charging port (part ~Rs 400), Motherboard (part ~Rs 5000), Camera (part ~Rs 1200), Speaker (part ~Rs 300), Back glass (part ~Rs 600)
- **Laptop:** Battery (part ~Rs 3500, hazardous), Display (part ~Rs 6000), Motherboard (part ~Rs 12000), Keyboard (part ~Rs 1800), Hinge (part ~Rs 900), Charging port (part ~Rs 700), SSD storage (part ~Rs 3000)
- **RO water purifier:** RO membrane (part ~Rs 2200), Solenoid valve (part ~Rs 550), Booster pump (part ~Rs 1800), Power adapter (SMPS) (part ~Rs 900), Float switch (part ~Rs 250), UV lamp (part ~Rs 900, hazardous)
- **Refrigerator:** Compressor (part ~Rs 6500), Relay and overload (part ~Rs 450), Thermostat (part ~Rs 600), Gas leak in cooling circuit (part ~Rs 2500), Defrost heater (part ~Rs 700), Control board (part ~Rs 2800), Fan motor (part ~Rs 900), Door gasket (part ~Rs 900)
- **Air conditioner:** Compressor (part ~Rs 9000), Capacitor (part ~Rs 600), Control board (part ~Rs 3500), Fan motor (part ~Rs 2200), Gas leak in cooling circuit (part ~Rs 3000), Temperature sensor (part ~Rs 400)
- **Home inverter:** Lead-acid battery (part ~Rs 11000, hazardous), Control board (part ~Rs 2500), Transformer (part ~Rs 3000), MOSFET bank (part ~Rs 900), Cooling fan (part ~Rs 300), Display panel (part ~Rs 400)
