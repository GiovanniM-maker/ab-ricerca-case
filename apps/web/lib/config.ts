// Punto di ancoraggio — tenuto allineato a /data/flatiron.json (fonte canonica).
export const FLATIRON = {
  label: "43 W 23rd St, New York, NY 10010",
  lat: 40.742184,
  lng: -73.990932,
};

// Il budget: sopra questo affitto mensile (USD) una casa non entra nemmeno in
// elenco. Non e' un filtro da togliere, e' il tetto che ci siamo dati.
export const BUDGET_MAX = 4000;

// Dopo quanti giorni senza che nessuna fonte la mostri una casa si da' per
// persa (affittata o tolta dal sito) ed esce da "Tutte". Serve per le fonti
// che solo il crawl dal Mac raggiunge: il giro automatico le riporta avanti
// senza poterle ricontrollare.
export const GIORNI_PER_PERSA = 14;
